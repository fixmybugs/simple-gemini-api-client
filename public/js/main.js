document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chat-form');
    const chatWindow = document.getElementById('chat-window');
    const messageInput = document.getElementById('message');
    
    // Variables para archivos múltiples
    let selectedFiles = [];
    const fileInput = document.getElementById('file');
    const filePreview = document.getElementById('file-preview');
    const modelSelector = document.getElementById('model');
    const btnUploadImage = document.getElementById('btn-upload-image');
    const btnUploadDoc = document.getElementById('btn-upload-doc');
    const btnSend = document.getElementById('btn-send');
    const imageModal = document.getElementById('image-modal');
    const imageModalImg = document.getElementById('image-modal-img');

    let chatHistory = [];

    const DEFAULT_MODEL = 'gemini-1.5-flash';

    function normalizeModelName(name) {
        if (!name) return '';
        const parts = String(name).split('/');
        return parts[parts.length - 1];
    }

    // Cargar modelos disponibles desde el backend
    async function loadModels() {
        try {
            const res = await fetch('/api/models');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const models = Array.isArray(data?.models) ? data.models : [];

            modelSelector.innerHTML = '';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = normalizeModelName(m.name);
                opt.textContent = m.displayName || m.name;
                modelSelector.appendChild(opt);
            });

            if (models.length > 0) {
                const hasDefault = models.some(m => normalizeModelName(m.name) === DEFAULT_MODEL);
                modelSelector.value = hasDefault ? DEFAULT_MODEL : normalizeModelName(models[0].name);
            } else {
                addDefaultOptions();
            }
        } catch (e) {
            console.error('No se pudieron cargar los modelos:', e);
            addDefaultOptions();
        }
    }

    function addDefaultOptions() {
        modelSelector.innerHTML = '';
        const defaults = [
            { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
            { value: 'gemini-pro', label: 'Gemini Pro' },
            { value: 'imagen-2.0', label: 'Imagen 2.0 (Generación de Imágenes)' },
            { value: 'gemini-2.5-flash-image-preview', label: 'Gemini 2.5 Flash (Image Preview)' },
        ];
        defaults.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.value;
            opt.textContent = d.label;
            modelSelector.appendChild(opt);
        });
        modelSelector.value = DEFAULT_MODEL;
    }

    // Inicializar selector de modelos
    loadModels();

    // Estado de envío (loading en botón)
    function setSending(sending) {
        if (!btnSend) return;
        btnSend.classList.toggle('is-loading', sending);
        btnSend.disabled = sending;
    }

    // Burbuja temporal de "escribiendo" / loader en el chat
    function appendLoader(sender = 'model') {
        const isUser = sender === 'user';
        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', isUser ? 'is-user' : 'is-model');

        const bubble = document.createElement('div');
        bubble.classList.add('bubble', 'box', 'p-3', 'has-background-light', 'has-text-grey');

        const typing = document.createElement('div');
        typing.classList.add('typing');
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('span');
            dot.classList.add('dot');
            typing.appendChild(dot);
        }
        bubble.appendChild(typing);
        messageElement.appendChild(bubble);
        chatWindow.appendChild(messageElement);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return messageElement;
    }

    // Helpers para historial con archivos/imagenes
    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function dataUrlToInlinePart(dataUrl) {
        if (typeof dataUrl !== 'string') return null;
        const match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
        if (!match) return null;
        return { inlineData: { mimeType: match[1], data: match[2] } };
    }

    async function fileToInlinePart(file) {
        try {
            const dataUrl = await readFileAsDataURL(file);
            return dataUrlToInlinePart(dataUrl);
        } catch {
            return null;
        }
    }

    // ----- Modal de imagen (visor) -----
    function openImageModal(src) {
        if (!imageModal || !imageModalImg) return;
        imageModalImg.src = src;
        imageModalImg.classList.remove('is-zoomed');
        imageModal.classList.add('is-active');
    }

    function closeImageModal() {
        if (!imageModal || !imageModalImg) return;
        imageModal.classList.remove('is-active');
        imageModalImg.classList.remove('is-zoomed');
        imageModalImg.src = '';
    }

    if (imageModal) {
        const bg = imageModal.querySelector('.modal-background');
        const btnClose = imageModal.querySelector('.modal-close');
        bg && bg.addEventListener('click', closeImageModal);
        btnClose && btnClose.addEventListener('click', closeImageModal);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && imageModal.classList.contains('is-active')) closeImageModal();
        });
        if (imageModalImg) {
            imageModalImg.addEventListener('click', () => {
                imageModalImg.classList.toggle('is-zoomed');
            });
        }
    }

    // Botones para seleccionar archivos (imagen/documento)
    if (btnUploadImage) {
        btnUploadImage.addEventListener('click', () => {
            if (!fileInput) return;
            fileInput.value = '';
            fileInput.accept = 'image/*';
            fileInput.click();
        });
    }

    if (btnUploadDoc) {
        btnUploadDoc.addEventListener('click', () => {
            if (!fileInput) return;
            fileInput.value = '';
            fileInput.accept = 'image/*,audio/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            fileInput.click();
        });
    }

    // Manejar la subida de archivos para mostrar    // Gestión de archivos múltiples
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        
        // Limitar a 5 archivos máximo
        if (files.length > 5) {
            alert('Máximo 5 archivos permitidos');
            fileInput.value = '';
            selectedFiles = [];
            updateFilePreview();
            return;
        }
        
        // Verificar que las imágenes no excedan cierto tamaño (5MB por imagen)
        const maxSize = 5 * 1024 * 1024; // 5MB
        const oversizedFiles = files.filter(file => file.size > maxSize);
        if (oversizedFiles.length > 0) {
            alert(`Los siguientes archivos son demasiado grandes (máximo 5MB): ${oversizedFiles.map(f => f.name).join(', ')}`);
            fileInput.value = '';
            selectedFiles = [];
            updateFilePreview();
            return;
        }
        
        selectedFiles = files;
        updateFilePreview();
    });
    
    // Función para actualizar el preview de archivos
    function updateFilePreview() {
        if (selectedFiles.length === 0) {
            filePreview.innerHTML = '';
            return;
        }
        
        const previewHtml = selectedFiles.map((file, index) => {
            const isImage = file.type.startsWith('image/');
            const icon = isImage ? 'fas fa-image' : 'fas fa-file';
            return `
                <div class="file-item" style="display: inline-block; margin: 2px 5px; padding: 5px 8px; background: #f5f5f5; border-radius: 15px; font-size: 0.8rem;">
                    <i class="${icon}" style="margin-right: 5px;"></i>
                    ${file.name}
                    <button type="button" onclick="removeFile(${index})" style="margin-left: 5px; background: none; border: none; color: #ff3860; cursor: pointer;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        }).join('');
        
        filePreview.innerHTML = `
            <div style="margin-top: 5px;">
                <small style="color: #666;">Archivos seleccionados (${selectedFiles.length}/5):</small>
                <div style="margin-top: 5px;">${previewHtml}</div>
            </div>
        `;
    }
    
    // Función global para remover archivos
    window.removeFile = function(index) {
        selectedFiles.splice(index, 1);
        updateFilePreview();
        
        // Actualizar el input file
        const dt = new DataTransfer();
        selectedFiles.forEach(file => dt.items.add(file));
        fileInput.files = dt.files;
    };

    // Enviar el formulario
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const message = messageInput.value.trim();
        const files = selectedFiles;

        if (!message && files.length === 0) {
            return;
        }

        // Añadir mensaje del usuario a la ventana de chat con múltiples archivos
        appendMessage({ sender: 'user', text: message, files: files });
        // Mostrar loader del modelo y activar estado de envío
        let loaderEl = appendLoader('model');
        setSending(true);

        // Verificar que hay una sesión activa
        if (!window.currentSessionId) {
            appendMessage({ sender: 'model', text: 'Por favor, selecciona o crea un chat primero.' });
            setSending(false);
            return;
        }

        try {
            // Get auth token from parent window (chat.ejs)
            const authToken = window.authToken;
            
            // Crear FormData y añadir datos
            const formData = new FormData();
            formData.append('message', message);
            formData.append('history', JSON.stringify(chatHistory));
            formData.append('model', modelSelector.value);
            formData.append('sessionId', window.currentSessionId);
            
            // Añadir múltiples archivos
            files.forEach((file, index) => {
                formData.append(`files`, file);
            });
            
            const headers = {};
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: headers,
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Error del servidor: ${response.statusText}`);
            }

            const data = await response.json();

            // Mostrar respuesta multimodal en la UI
            if (data.text || data.images || data.image) {
                const messageData = { 
                    sender: 'model', 
                    usage: data.usage || null,
                    isDirectResponse: true 
                };

                // Agregar texto si existe
                if (data.text) {
                    messageData.text = data.text;
                }

                // Agregar múltiples imágenes si existen
                if (data.images && data.images.length > 0) {
                    messageData.images = data.images;
                }

                // Mantener compatibilidad con imagen única
                if (data.image && !data.images) {
                    messageData.image = data.image;
                }

                appendMessage(messageData);
            } else if (data.response) {
                // Fallback para respuestas de solo texto
                appendMessage({ 
                    sender: 'model', 
                    text: data.response, 
                    usage: data.usage || null,
                    isDirectResponse: true 
                });
            }

            // No necesitamos manejar historial localmente ya que se guarda en Supabase
            // El historial se carga desde la base de datos cuando se selecciona un chat

        } catch (error) {
            console.error('Error al enviar el mensaje:', error);
            appendMessage({ sender: 'model', text: 'Lo siento, ha ocurrido un error.' });
        } finally {
            if (loaderEl && loaderEl.parentNode) loaderEl.remove();
            setSending(false);
            
            // Limpiar formulario
            messageInput.value = '';
            selectedFiles = [];
            fileInput.value = '';
            filePreview.innerHTML = '';
        }
    });

    function appendMessage(data) {
        const { sender, text, file, files, image, images, usage, isDirectResponse } = data;
        const isUser = sender === 'user';

        const messageElement = document.createElement('div');
        messageElement.classList.add('chat-message', isUser ? 'is-user' : 'is-model');

        const bubble = document.createElement('div');
        bubble.classList.add('bubble', 'box', 'p-3');
        if (isUser) {
            bubble.classList.add('has-background-primary', 'has-text-white');
        } else {
            bubble.classList.add('has-background-light');
        }

        if (text) {
            const textElement = document.createElement('p');
            textElement.innerText = text;
            bubble.appendChild(textElement);
        }

        // Mostrar archivos múltiples si existen
        if (files && files.length > 0) {
            const filesContainer = document.createElement('div');
            filesContainer.classList.add('files-container', 'mt-2');
            
            files.forEach((file, index) => {
                const fileElement = document.createElement('div');
                fileElement.classList.add('file-attachment', 'mb-2');
                
                if (file.type && file.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = URL.createObjectURL(file);
                    img.alt = file.name;
                    img.style.maxWidth = '150px';
                    img.style.maxHeight = '150px';
                    img.style.borderRadius = '8px';
                    img.style.cursor = 'pointer';
                    img.style.marginRight = '8px';
                    img.style.marginBottom = '4px';
                    img.onclick = () => showImageModal(img.src);
                    fileElement.appendChild(img);
                } else {
                    const fileInfo = document.createElement('div');
                    fileInfo.innerHTML = `<i class="fas fa-file"></i> ${file.name}`;
                    fileElement.appendChild(fileInfo);
                }
                
                filesContainer.appendChild(fileElement);
            });
            
            bubble.appendChild(filesContainer);
        }
        
        // Mantener compatibilidad con archivo único
        if (file && !files) {
            const fileElement = document.createElement('div');
            fileElement.classList.add('file-attachment', 'mt-2');
            
            if (file.type && file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = URL.createObjectURL(file);
                img.alt = file.name;
                img.style.maxWidth = '200px';
                img.style.maxHeight = '200px';
                img.style.borderRadius = '8px';
                img.style.cursor = 'pointer';
                img.onclick = () => showImageModal(img.src);
                fileElement.appendChild(img);
            } else {
                const fileInfo = document.createElement('div');
                fileInfo.innerHTML = `<i class="fas fa-file"></i> ${file.name}`;
                fileElement.appendChild(fileInfo);
            }
            
            bubble.appendChild(fileElement);
        }

        // Renderizar múltiples imágenes si existen
        if (images && images.length > 0) {
            const imagesContainer = document.createElement('div');
            imagesContainer.classList.add('images-container', 'mt-2');
            imagesContainer.style.display = 'flex';
            imagesContainer.style.flexWrap = 'wrap';
            imagesContainer.style.gap = '8px';
            
            images.forEach((imageUrl, index) => {
                const imageWrapper = document.createElement('div');
                imageWrapper.style.position = 'relative';
                imageWrapper.style.display = 'inline-block';
                
                const figure = document.createElement('figure');
                figure.classList.add('image');
                const imageElement = document.createElement('img');
                
                imageElement.src = imageUrl;
                imageElement.alt = `Imagen generada ${index + 1}`;
                imageElement.style.maxWidth = '200px';
                imageElement.style.maxHeight = '200px';
                imageElement.style.borderRadius = '8px';
                imageElement.style.cursor = 'pointer';
                imageElement.onclick = () => showImageModal(imageUrl);
                
                imageElement.onerror = function() {
                    console.error('Error loading image:', imageUrl);
                    this.style.display = 'none';
                };
                
                // Botones de acción para la imagen
                const actionsContainer = document.createElement('div');
                actionsContainer.classList.add('image-actions');
                actionsContainer.style.position = 'absolute';
                actionsContainer.style.top = '8px';
                actionsContainer.style.right = '8px';
                actionsContainer.style.display = 'flex';
                actionsContainer.style.gap = '4px';
                actionsContainer.style.opacity = '0';
                actionsContainer.style.transition = 'opacity 0.2s ease';
                
                // Botón para ver en grande
                const zoomBtn = document.createElement('button');
                zoomBtn.classList.add('button', 'is-small', 'is-white');
                zoomBtn.style.borderRadius = '50%';
                zoomBtn.style.width = '32px';
                zoomBtn.style.height = '32px';
                zoomBtn.style.padding = '0';
                zoomBtn.innerHTML = '<i class="fas fa-search-plus"></i>';
                zoomBtn.title = 'Ver en grande';
                zoomBtn.onclick = (e) => {
                    e.stopPropagation();
                    showImageModal(imageUrl);
                };
                
                // Botón para descargar
                const downloadBtn = document.createElement('button');
                downloadBtn.classList.add('button', 'is-small', 'is-white');
                downloadBtn.style.borderRadius = '50%';
                downloadBtn.style.width = '32px';
                downloadBtn.style.height = '32px';
                downloadBtn.style.padding = '0';
                downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
                downloadBtn.title = 'Descargar imagen';
                downloadBtn.onclick = (e) => {
                    e.stopPropagation();
                    downloadImage(imageUrl, `imagen-generada-${index + 1}.png`);
                };
                
                actionsContainer.appendChild(zoomBtn);
                actionsContainer.appendChild(downloadBtn);
                
                // Mostrar botones al hacer hover
                imageWrapper.onmouseenter = () => {
                    actionsContainer.style.opacity = '1';
                };
                imageWrapper.onmouseleave = () => {
                    actionsContainer.style.opacity = '0';
                };
                
                figure.appendChild(imageElement);
                imageWrapper.appendChild(figure);
                imageWrapper.appendChild(actionsContainer);
                imagesContainer.appendChild(imageWrapper);
            });
            
            bubble.appendChild(imagesContainer);
        }

        // Mantener compatibilidad con imagen única
        if (image && !images) {
            const imageWrapper = document.createElement('div');
            imageWrapper.style.position = 'relative';
            imageWrapper.style.display = 'inline-block';
            
            const figure = document.createElement('figure');
            figure.classList.add('image');
            const imageElement = document.createElement('img');
            
            imageElement.src = image;
            imageElement.alt = 'Imagen generada';
            imageElement.style.maxWidth = '300px';
            imageElement.style.maxHeight = '300px';
            imageElement.style.borderRadius = '8px';
            imageElement.style.cursor = 'pointer';
            imageElement.onclick = () => showImageModal(image);
            
            imageElement.onerror = function() {
                console.error('Error loading image:', image);
                this.style.display = 'none';
            };
            
            // Botones de acción para imagen única
            const actionsContainer = document.createElement('div');
            actionsContainer.classList.add('image-actions');
            actionsContainer.style.position = 'absolute';
            actionsContainer.style.top = '8px';
            actionsContainer.style.right = '8px';
            actionsContainer.style.display = 'flex';
            actionsContainer.style.gap = '4px';
            actionsContainer.style.opacity = '0';
            actionsContainer.style.transition = 'opacity 0.2s ease';
            
            // Botón para ver en grande
            const zoomBtn = document.createElement('button');
            zoomBtn.classList.add('button', 'is-small', 'is-white');
            zoomBtn.style.borderRadius = '50%';
            zoomBtn.style.width = '32px';
            zoomBtn.style.height = '32px';
            zoomBtn.style.padding = '0';
            zoomBtn.innerHTML = '<i class="fas fa-search-plus"></i>';
            zoomBtn.title = 'Ver en grande';
            zoomBtn.onclick = (e) => {
                e.stopPropagation();
                showImageModal(image);
            };
            
            // Botón para descargar
            const downloadBtn = document.createElement('button');
            downloadBtn.classList.add('button', 'is-small', 'is-white');
            downloadBtn.style.borderRadius = '50%';
            downloadBtn.style.width = '32px';
            downloadBtn.style.height = '32px';
            downloadBtn.style.padding = '0';
            downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
            downloadBtn.title = 'Descargar imagen';
            downloadBtn.onclick = (e) => {
                e.stopPropagation();
                downloadImage(image, 'imagen-generada.png');
            };
            
            actionsContainer.appendChild(zoomBtn);
            actionsContainer.appendChild(downloadBtn);
            
            // Mostrar botones al hacer hover
            imageWrapper.onmouseenter = () => {
                actionsContainer.style.opacity = '1';
            };
            imageWrapper.onmouseleave = () => {
                actionsContainer.style.opacity = '0';
            };
            
            figure.appendChild(imageElement);
            imageWrapper.appendChild(figure);
            imageWrapper.appendChild(actionsContainer);
            bubble.appendChild(imageWrapper);
        }


        // Mostrar conteo de tokens (sólo mensajes del modelo)
        if (!isUser && usage && (usage.totalTokenCount || usage.promptTokenCount || usage.candidatesTokenCount)) {
            const meta = document.createElement('p');
            meta.classList.add('is-size-7', 'has-text-grey', 'mt-2');
            const parts = [];
            if (typeof usage.promptTokenCount === 'number') parts.push(`prompt ${usage.promptTokenCount}`);
            if (typeof usage.candidatesTokenCount === 'number') parts.push(`output ${usage.candidatesTokenCount}`);
            if (typeof usage.totalTokenCount === 'number') parts.push(`total ${usage.totalTokenCount}`);
            meta.textContent = `Tokens: ${parts.join(', ')}`;
            bubble.appendChild(meta);
        }

        messageElement.appendChild(bubble);
        chatWindow.appendChild(messageElement);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    // Función para descargar imagen
    async function downloadImage(imageUrl, filename) {
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error downloading image:', error);
            // Fallback: abrir imagen en nueva pestaña
            window.open(imageUrl, '_blank');
        }
    }

    // Función para mostrar modal de imagen (global)
    window.showImageModal = function(imageSrc) {
        const modal = document.getElementById('image-modal');
        const modalImg = document.getElementById('image-modal-img');
        modalImg.src = imageSrc;
        modal.classList.add('is-active');
    };

    // Hacer downloadImage global para acceso desde botones
    window.downloadImage = downloadImage;
});
