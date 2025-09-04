import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Función auxiliar para verificar si un documento es soportado por Gemini
function isDocumentSupported(mimeType) {
    const supportedTypes = [
        'application/pdf',
        'text/plain',
        'text/csv',
        'text/html',
        'text/markdown',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'audio/wav',
        'audio/mp3',
        'audio/aiff',
        'audio/aac',
        'audio/ogg',
        'audio/flac'
    ];
    return supportedTypes.includes(mimeType);
}

// Función auxiliar para convertir archivo a GenerativePart
function fileToGenerativePart(buffer, mimeType) {
    return {
        inlineData: {
            data: buffer.toString('base64'),
            mimeType: mimeType,
        },
    };
};

// Listar modelos disponibles desde la API
const listModels = async (req, res) => {
    try {
        const pager = await genAI.models.list();
        const models = [];
        for await (const m of pager) {
            const name = m.name || '';
            const norm = String(name).split('/').pop() || name;
            const lower = norm.toLowerCase();
            if (!(lower.startsWith('gemini') || lower.startsWith('imagen'))) continue;
            models.push({
                name,
                displayName: m.displayName || norm,
                supportedActions: m.supportedActions || [],
            });
        }
        models.sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));
        res.json({ models });
    } catch (err) {
        console.error('Error al listar modelos:', err);
        res.status(500).json({ error: 'No se pudieron obtener los modelos' });
    }
};

const handleChat = async (req, res) => {
    try {
        const { message, history, model, sessionId } = req.body;
        const files = req.files || [];
        const userId = req.user.id;

        if (!message && files.length === 0) {
            return res.status(400).json({ error: 'Se requiere un mensaje o al menos un archivo.' });
        }

        if (!sessionId) {
            return res.status(400).json({ error: 'Se requiere un sessionId.' });
        }

        // Para multimodalidad, se recomienda usar un modelo como gemini-1.5-flash
        const selectedModel = model || 'gemini-1.5-flash';
        // @google/genai v1.16.0 usa ai.chats y ai.models en lugar de getGenerativeModel/startChat

        const promptParts = [];

        // Añadir múltiples archivos si existen
        if (files && files.length > 0) {
            for (const file of files) {
                if (file.mimetype.startsWith('image/')) {
                    promptParts.push(fileToGenerativePart(file.buffer, file.mimetype));
                } else if (isDocumentSupported(file.mimetype)) {
                    // Procesar documentos soportados
                    promptParts.push(fileToGenerativePart(file.buffer, file.mimetype));
                }
            }
        }

        // Añadir el mensaje de texto (como part explícito)
        if (message) {
            promptParts.push({ text: message });
        }

        // Verificar que el usuario tenga acceso a esta sesión
        const { data: userRecord } = await supabase
            .from('users')
            .select('id')
            .eq('user_id', userId)
            .single();

        if (!userRecord) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const { data: session } = await supabase
            .from('chat_sessions')
            .select('id, model')
            .eq('id', sessionId)
            .eq('user_id', userRecord.id)
            .single();

        if (!session) {
            return res.status(403).json({ error: 'Acceso denegado a esta sesión' });
        }

        // Usar el modelo de la sesión si no se especifica otro
        const sessionModel = selectedModel === 'gemini-1.5-flash' ? session.model : selectedModel;

        // Guardar mensaje del usuario en la base de datos
        let userFilePaths = [];
        if (files.length > 0) {
            for (const file of files) {
                const timestamp = new Date().getTime();
                const randomId = Math.random().toString(36).substring(2, 8);
                const fileExtension = file.originalname.split('.').pop();
                const filePath = `chat/${sessionId}/user_${timestamp}_${randomId}.${fileExtension}`;
                
                const { error: fileUploadError } = await supabase.storage
                    .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                    .upload(filePath, file.buffer, {
                        contentType: file.mimetype,
                        upsert: false
                    });

                if (!fileUploadError) {
                    userFilePaths.push({
                        path: filePath,
                        name: file.originalname,
                        type: file.mimetype,
                        messageType: file.mimetype.startsWith('image/') ? 'image' : 'file'
                    });
                } else {
                    console.error('Error uploading user file:', fileUploadError);
                }
            }
        }

        // Guardar mensaje del usuario con archivos múltiples
        if (userFilePaths.length > 0) {
            // Crear un mensaje por cada archivo para mejor organización
            for (const fileInfo of userFilePaths) {
                await supabase.rpc(
                    'add_chat_message',
                    {
                        p_session_id: sessionId,
                        p_role: 'user',
                        p_content: message || null,
                        p_message_type: fileInfo.messageType,
                        p_file_path: fileInfo.path,
                        p_file_name: fileInfo.name,
                        p_file_type: fileInfo.type,
                        p_metadata: { fileIndex: userFilePaths.indexOf(fileInfo) }
                    }
                );
            }
        } else if (message) {
            // Guardar mensaje del usuario sin archivos
            await supabase.rpc(
                'add_chat_message',
                {
                    p_session_id: sessionId,
                    p_role: 'user',
                    p_content: message,
                    p_message_type: 'text',
                    p_file_path: null,
                    p_file_name: null,
                    p_file_type: null,
                    p_metadata: {}
                }
            );
        }

        // Lógica para generación de imágenes
        if (sessionModel && sessionModel.toLowerCase().startsWith('imagen')) {
            if (!message) {
                return res.status(400).json({ error: 'Se requiere un prompt de texto para generar imágenes.' });
            }

            // Generación de imagen con models.generateImages
            const imgResp = await genAI.models.generateImages({
                model: sessionModel,
                prompt: message,
                config: { numberOfImages: 1 },
            });
            const imageBase64 = imgResp?.generatedImages?.[0]?.image?.imageBytes;

            if (imageBase64) {
                // Subir imagen generada a Supabase Storage ANTES de responder
                const timestamp = new Date().getTime();
                const imagePath = `chat/${sessionId}/generated_${timestamp}.png`;
                
                // Convertir base64 a buffer
                const imageBuffer = Buffer.from(imageBase64, 'base64');
                
                const { error: imageUploadError } = await supabase.storage
                    .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                    .upload(imagePath, imageBuffer, {
                        contentType: 'image/png',
                        upsert: false
                    });

                if (!imageUploadError) {
                    // Guardar respuesta del modelo con la imagen
                    await supabase.rpc(
                        'add_chat_message',
                        {
                            p_session_id: sessionId,
                            p_role: 'model',
                            p_content: null,
                            p_message_type: 'image',
                            p_file_path: imagePath,
                            p_file_name: `generated_${timestamp}.png`,
                            p_file_type: 'image/png',
                            p_metadata: {}
                        }
                    );

                    // Intentar URL firmada, fallback a URL pública
                    const { data: signedData, error: urlError } = await supabase.storage
                        .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                        .createSignedUrl(imagePath, 3600);

                    if (!urlError && signedData?.signedUrl) {
                        res.json({ image: signedData.signedUrl, isStoredImage: true });
                    } else {
                        // Fallback a URL pública
                        const { data: { publicUrl } } = supabase.storage
                            .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                            .getPublicUrl(imagePath);
                        
                        res.json({ image: publicUrl, isStoredImage: true });
                    }
                } else {
                    console.error('Error uploading generated image:', imageUploadError);
                    res.json({ image: `data:image/png;base64,${imageBase64}`, isStoredImage: false });
                }
            } else {
                res.status(500).json({ error: 'La API no devolvió una imagen.' });
            }

        } else if (sessionModel === 'gemini-2.5-flash-image-preview') {
            // Chat con soporte de imagen en la respuesta (preview)
            // Obtener historial de la base de datos
            const { data: dbHistory } = await supabase.rpc(
                'get_chat_history',
                { p_session_id: sessionId }
            );

            // Convertir historial de la base de datos al formato de Gemini
            const geminiHistory = [];
            if (dbHistory && dbHistory.length > 0) {
                for (const msg of dbHistory) {
                    if (msg.role === 'user') {
                        const parts = [];
                        if (msg.content) {
                            parts.push({ text: msg.content });
                        }
                        if (msg.file_path && (msg.message_type === 'image' || msg.message_type === 'file')) {
                            // Obtener archivo de Supabase Storage
                            const { data: fileData } = await supabase.storage
                                .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                                .download(msg.file_path);
                            
                            if (fileData) {
                                const fileBuffer = await fileData.arrayBuffer();
                                const base64Data = Buffer.from(fileBuffer).toString('base64');
                                parts.push({
                                    inlineData: {
                                        data: base64Data,
                                        mimeType: msg.file_type
                                    }
                                });
                            }
                        }
                        if (parts.length > 0) {
                            geminiHistory.push({ role: 'user', parts });
                        }
                    } else if (msg.role === 'model' && msg.content) {
                        geminiHistory.push({ role: 'model', parts: [{ text: msg.content }] });
                    }
                }
            }

            // Añadir mensaje actual del usuario con múltiples archivos
            const currentParts = [];
            if (message) {
                currentParts.push({ text: message });
            }
            
            // Procesar múltiples archivos (imágenes y documentos)
            for (const file of files) {
                if (file.mimetype.startsWith('image/') || isDocumentSupported(file.mimetype)) {
                    const base64Data = file.buffer.toString('base64');
                    currentParts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: file.mimetype
                        }
                    });
                }
            }

            // Enviar al modelo usando la API correcta para @google/genai v1.16.0
            const response = await genAI.models.generateContent({
                model: sessionModel,
                contents: [...geminiHistory, { role: 'user', parts: currentParts }]
            });

            console.log('Gemini response structure:', {
                hasText: !!response.text,
                hasParts: !!response.parts,
                partsLength: response.parts?.length || 0,
                responseKeys: Object.keys(response)
            });

            const usage = response.usage;
            let responseData = { usage };
            let hasContent = false;

            // Procesar todas las partes de la respuesta (texto e imágenes)
            // Primero intentar acceder a response.candidates[0].content.parts
            const responseParts = response.candidates?.[0]?.content?.parts || response.parts;
            
            if (responseParts && responseParts.length > 0) {
                let textParts = [];
                let imageParts = [];

                for (const part of responseParts) {
                    if (part.text) {
                        textParts.push(part.text);
                    } else if (part.inlineData) {
                        // Procesar imagen directamente de inlineData
                        const base64Data = part.inlineData.data;
                        const mimeType = part.inlineData.mimeType;
                        
                        // Subir imagen a Supabase Storage
                        const timestamp = new Date().getTime();
                        const imagePath = `chat/${sessionId}/response_${timestamp}.png`;
                        const imageBuffer = Buffer.from(base64Data, 'base64');
                        
                        const { error: imageUploadError } = await supabase.storage
                            .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                            .upload(imagePath, imageBuffer, {
                                contentType: mimeType,
                                upsert: false
                            });

                        if (!imageUploadError) {
                            // Intentar URL firmada, fallback a URL pública
                            const { data: signedData, error: urlError } = await supabase.storage
                                .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                                .createSignedUrl(imagePath, 3600);

                            let imageUrl;
                            if (!urlError && signedData?.signedUrl) {
                                imageUrl = signedData.signedUrl;
                            } else {
                                const { data: { publicUrl } } = supabase.storage
                                    .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                                    .getPublicUrl(imagePath);
                                imageUrl = publicUrl;
                            }

                            imageParts.push({
                                url: imageUrl,
                                path: imagePath,
                                filename: `response_${timestamp}.png`,
                                mimeType: mimeType
                            });
                        } else {
                            console.error('Error uploading response image:', imageUploadError);
                            imageParts.push({
                                url: `data:${mimeType};base64,${base64Data}`,
                                isBase64: true
                            });
                        }
                    }
                }

                // Guardar texto si existe
                if (textParts.length > 0) {
                    const combinedText = textParts.join('\n');
                    await supabase.rpc(
                        'add_chat_message',
                        {
                            p_session_id: sessionId,
                            p_role: 'model',
                            p_content: combinedText,
                            p_message_type: 'text',
                            p_file_path: null,
                            p_file_name: null,
                            p_file_type: null,
                            p_metadata: usage ? { usage } : {}
                        }
                    );
                    responseData.text = combinedText;
                    hasContent = true;
                }

                // Guardar imágenes
                for (const imagePart of imageParts) {
                    if (!imagePart.isBase64) {
                        await supabase.rpc(
                            'add_chat_message',
                            {
                                p_session_id: sessionId,
                                p_role: 'model',
                                p_content: null,
                                p_message_type: 'image',
                                p_file_path: imagePart.path,
                                p_file_name: imagePart.filename,
                                p_file_type: imagePart.mimeType,
                                p_metadata: usage ? { usage } : {}
                            }
                        );
                    }
                }

                if (imageParts.length > 0) {
                    responseData.images = imageParts.map(img => img.url);
                    hasContent = true;
                }

                if (hasContent) {
                    return res.json(responseData);
                }
            }

            // Fallback a texto si no hay partes
            const text = response.text;
            
            // Guardar respuesta de texto del modelo
            await supabase.rpc(
                'add_chat_message',
                {
                    p_session_id: sessionId,
                    p_role: 'model',
                    p_content: text,
                    p_message_type: 'text',
                    p_file_path: null,
                    p_file_name: null,
                    p_file_type: null,
                    p_metadata: usage ? { usage } : {}
                }
            );

            res.json({ response: text, usage });

        } else { // Lógica para chat convencional
            // Obtener historial de la base de datos en lugar del frontend
            const { data: dbHistory } = await supabase.rpc(
                'get_chat_history',
                { p_session_id: sessionId }
            );

            // Convertir historial de BD a formato Gemini
            const geminiHistory = [];
            if (dbHistory && dbHistory.length > 0) {
                for (const msg of dbHistory) {
                    const parts = [];
                    
                    if (msg.content) {
                        parts.push({ text: msg.content });
                    }
                    
                    if (msg.file_path && (msg.message_type === 'image' || msg.message_type === 'file')) {
                        // Para imágenes y documentos, necesitamos convertir a base64
                        try {
                            const { data: fileData } = await supabase.storage
                                .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                                .download(msg.file_path);
                            
                            if (fileData) {
                                const buffer = await fileData.arrayBuffer();
                                const base64 = Buffer.from(buffer).toString('base64');
                                parts.push({
                                    inlineData: {
                                        data: base64,
                                        mimeType: msg.file_type || 'image/png'
                                    }
                                });
                            }
                        } catch (error) {
                            console.error('Error loading file from storage:', error);
                        }
                    }
                    
                    if (parts.length > 0) {
                        geminiHistory.push({
                            role: msg.role,
                            parts
                        });
                    }
                }
            }

            // Añadir mensaje actual del usuario con múltiples archivos
            const promptParts = [];
            if (message) {
                promptParts.push({ text: message });
            }
            
            // Procesar múltiples archivos (imágenes y documentos)
            for (const file of files) {
                if (file.mimetype.startsWith('image/') || isDocumentSupported(file.mimetype)) {
                    const base64Data = file.buffer.toString('base64');
                    promptParts.push({
                        inlineData: {
                            data: base64Data,
                            mimeType: file.mimetype
                        }
                    });
                }
            }

            const msgParts = promptParts.length > 0 ? promptParts : (message ? [{ text: message }] : []);
            const response = await genAI.models.generateContent({
                model: sessionModel,
                contents: [...geminiHistory, { role: 'user', parts: msgParts }]
            });
            const text = response.text;

            // Guardar respuesta del modelo
            await supabase.rpc(
                'add_chat_message',
                {
                    p_session_id: sessionId,
                    p_role: 'model',
                    p_content: text,
                    p_message_type: 'text',
                    p_file_path: null,
                    p_file_name: null,
                    p_file_type: null,
                    p_metadata: response?.usageMetadata ? { usage: response.usageMetadata } : {}
                }
            );

            res.json({ response: text, usage: response?.usageMetadata || null });
        }

    } catch (error) {
        console.error('Error procesando el chat:', error);
        res.status(500).json({ error: 'Error al procesar el chat con la API de Gemini' });
    }
};

// Get chat sessions for authenticated user
const getChatSessions = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get user record from our users table
        const { data: userRecord } = await supabase
            .from('users')
            .select('id')
            .eq('user_id', userId)
            .single();
            
        if (!userRecord) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Get chat sessions for this user
        const { data: sessions, error } = await supabase
            .from('chat_session_summaries')
            .select('*')
            .eq('user_id', userRecord.id)
            .order('is_pinned', { ascending: false })
            .order('last_message_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ sessions });
    } catch (error) {
        console.error('Error getting chat sessions:', error);
        res.status(500).json({ error: 'Error al obtener las sesiones de chat' });
    }
};

// Get chat history for a specific session
const getChatHistory = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.id;
        
        // Verify user owns this session
        const { data: userRecord } = await supabase
            .from('users')
            .select('id')
            .eq('user_id', userId)
            .single();
            
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', userRecord.id)
            .single();
            
        if (!session) {
            return res.status(403).json({ error: 'Acceso denegado a esta sesión' });
        }
        
        // Get messages for this session
        const { data: messages, error } = await supabase.rpc(
            'get_chat_history',
            { p_session_id: sessionId }
        );
        
        if (error) throw error;
        
        res.json({ messages });
    } catch (error) {
        console.error('Error getting chat history:', error);
        res.status(500).json({ error: 'Error al obtener el historial del chat' });
    }
};

// Create a new chat session
const createNewChat = async (req, res) => {
    try {
        const { title, model } = req.body;
        const userId = req.user.id;
        
        // Get user record
        const { data: userRecord } = await supabase
            .from('users')
            .select('id')
            .eq('user_id', userId)
            .single();
            
        if (!userRecord) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        // Create new session
        const { data: sessionId, error } = await supabase.rpc(
            'create_chat_session',
            {
                p_user_id: userRecord.id,
                p_title: title || 'Nueva conversación',
                p_model: model || 'gemini-1.5-flash'
            }
        );
        
        if (error) throw error;
        
        res.json({ sessionId });
    } catch (error) {
        console.error('Error creating chat session:', error);
        res.status(500).json({ error: 'Error al crear la sesión de chat' });
    }
};

// Update chat session title
const updateChatTitle = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { title } = req.body;
        const userId = req.user.id;
        
        // Verify ownership
        const { data: userRecord } = await supabase
            .from('users')
            .select('id')
            .eq('user_id', userId)
            .single();
            
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', userRecord.id)
            .single();
            
        if (!session) {
            return res.status(403).json({ error: 'Acceso denegado a esta sesión' });
        }
        
        // Update title
        const { error } = await supabase.rpc(
            'update_chat_session_title',
            {
                p_session_id: sessionId,
                p_title: title
            }
        );
        
        if (error) throw error;
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating chat title:', error);
        res.status(500).json({ error: 'Error al actualizar el título del chat' });
    }
};

// Delete a chat session
const deleteChat = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.id;
        
        // Verify ownership
        const { data: userRecord } = await supabase
            .from('users')
            .select('id')
            .eq('user_id', userId)
            .single();
            
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', userRecord.id)
            .single();
            
        if (!session) {
            return res.status(403).json({ error: 'Acceso denegado a esta sesión' });
        }
        
        // Get all messages with file paths before deletion
        const { data: messages } = await supabase
            .from('chat_messages')
            .select('file_path')
            .eq('session_id', sessionId)
            .not('file_path', 'is', null);
        
        // Delete files from storage
        if (messages && messages.length > 0) {
            const filePaths = messages.map(msg => msg.file_path);
            console.log('Deleting files from storage:', filePaths);
            
            const { error: storageError } = await supabase.storage
                .from(process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage')
                .remove(filePaths);
                
            if (storageError) {
                console.error('Error deleting files from storage:', storageError);
                // Continue with session deletion even if storage deletion fails
            }
        }
        
        // Delete session and related messages (cascade)
        const { error } = await supabase.rpc(
            'delete_chat_session',
            { p_session_id: sessionId }
        );
        
        if (error) throw error;
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting chat session:', error);
        res.status(500).json({ error: 'Error al eliminar la sesión de chat' });
    }
};

export { handleChat, listModels, getChatSessions, getChatHistory, createNewChat, updateChatTitle, deleteChat };
