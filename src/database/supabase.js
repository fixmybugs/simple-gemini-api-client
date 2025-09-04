import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Storage bucket name
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'custom-gemini-chat-storage';

/**
 * Chat Session Management
 */

// Get all chat sessions for the current user
export async function getChatSessions() {
  const { data: user } = await supabase.auth.getUser();
  if (!user) return { error: 'No authenticated user' };

  const { data, error } = await supabase
    .from('chat_session_summaries')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('last_message_at', { ascending: false });

  return { data, error };
}

// Create a new chat session
export async function createChatSession(title, model) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return { error: 'No authenticated user' };

  // Get the internal user ID
  const { data: userRecord } = await supabase
    .from('users')
    .select('id')
    .eq('user_id', userData.user.id)
    .single();

  if (!userRecord) return { error: 'User record not found' };

  const { data, error } = await supabase.rpc(
    'create_chat_session',
    {
      p_user_id: userRecord.id,
      p_title: title || 'Nueva conversación',
      p_model: model || 'gemini-1.5-flash'
    }
  );

  return { sessionId: data, error };
}

// Get chat history for a specific session
export async function getChatHistory(sessionId) {
  const { data, error } = await supabase.rpc(
    'get_chat_history',
    { p_session_id: sessionId }
  );

  return { messages: data, error };
}

// Add a message to a chat session
export async function addChatMessage(sessionId, role, content, messageType = 'text', file = null) {
  let filePath = null;
  let fileName = null;
  let fileType = null;
  
  // If there's a file, upload it to storage first
  if (file) {
    const uploadResult = await uploadChatFile(sessionId, file);
    if (uploadResult.error) return { error: uploadResult.error };
    
    filePath = uploadResult.path;
    fileName = file.name;
    fileType = file.type;
  }
  
  // Add the message to the database
  const { data, error } = await supabase.rpc(
    'add_chat_message',
    {
      p_session_id: sessionId,
      p_role: role,
      p_content: content,
      p_message_type: messageType,
      p_file_path: filePath,
      p_file_name: fileName,
      p_file_type: fileType,
      p_metadata: {}
    }
  );
  
  return { messageId: data, error };
}

// Update chat session title
export async function updateChatSessionTitle(sessionId, title) {
  const { error } = await supabase.rpc(
    'update_chat_session_title',
    {
      p_session_id: sessionId,
      p_title: title
    }
  );
  
  return { error };
}

// Toggle pin status for a chat session
export async function toggleChatSessionPin(sessionId) {
  const { data, error } = await supabase.rpc(
    'toggle_chat_session_pin',
    { p_session_id: sessionId }
  );
  
  return { isPinned: data, error };
}

// Archive or unarchive a chat session
export async function archiveChatSession(sessionId, archive = true) {
  const { error } = await supabase.rpc(
    'archive_chat_session',
    {
      p_session_id: sessionId,
      p_archive: archive
    }
  );
  
  return { error };
}

// Delete a chat session
export async function deleteChatSession(sessionId) {
  // First, delete any associated files from storage
  await deleteSessionFiles(sessionId);
  
  // Then delete the session (which will cascade delete messages)
  const { error } = await supabase.rpc(
    'delete_chat_session',
    { p_session_id: sessionId }
  );
  
  return { error };
}

/**
 * File Storage Management
 */

// Upload a file for a chat message
export async function uploadChatFile(sessionId, file) {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return { error: 'No authenticated user' };
  
  // Generate a unique file path
  const timestamp = new Date().getTime();
  const fileExt = file.name.split('.').pop();
  const filePath = `chat/${sessionId}/${timestamp}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
  
  // Upload the file
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filePath, file);
  
  if (error) return { error };
  
  // Get the public URL
  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filePath);
  
  return { path: filePath, url: publicUrl, error: null };
}

// Upload a generated image
export async function uploadGeneratedImage(sessionId, base64Image) {
  // Convert base64 to blob
  const parts = base64Image.split(';base64,');
  const contentType = parts[0].split(':')[1];
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);
  
  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }
  
  const blob = new Blob([uInt8Array], { type: contentType });
  const file = new File([blob], `generated_image_${Date.now()}.png`, { type: 'image/png' });
  
  // Upload the file
  return await uploadChatFile(sessionId, file);
}

// Get a file from storage
export async function getChatFile(filePath) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(filePath);
  
  if (error) return { error };
  
  return { file: data, error: null };
}

// Delete all files associated with a session
async function deleteSessionFiles(sessionId) {
  // List all files in the session's folder
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(`chat/${sessionId}`);
  
  if (error || !data) return { error };
  
  // Delete each file
  const filesToDelete = data.map(file => `chat/${sessionId}/${file.name}`);
  if (filesToDelete.length > 0) {
    const { error: deleteError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(filesToDelete);
    
    if (deleteError) return { error: deleteError };
  }
  
  return { error: null };
}

/**
 * Authentication helpers
 */

// Sign in with email and password
export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  return { session: data.session, user: data.user, error };
}

// Sign up with email and password
export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password
  });
  
  return { session: data.session, user: data.user, error };
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

// Get current session
export async function getCurrentSession() {
  const { data, error } = await supabase.auth.getSession();
  return { session: data.session, error };
}

// Convert chat history to Gemini API format
export function convertToGeminiHistory(messages) {
  if (!messages || !Array.isArray(messages)) return [];
  
  return messages.map(msg => {
    const parts = [];
    
    // Handle text content
    if (msg.content) {
      parts.push({ text: msg.content });
    }
    
    // Handle file content (images)
    if (msg.file_path && msg.message_type === 'image') {
      const { data: { publicUrl } } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(msg.file_path);
      
      // For images, we'll need to fetch them and convert to base64 on the client
      // This is handled separately in the UI code
      parts.push({ imageUrl: publicUrl });
    }
    
    return {
      role: msg.role,
      parts
    };
  });
}

export default supabase;
