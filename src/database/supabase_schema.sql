-- SCHEMA SETUP FOR GEMINI CHAT APPLICATION WITH SUPABASE

-- Enable UUID extension for generating unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table to track authenticated users
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT UNIQUE NOT NULL, -- This will store the Supabase auth.uid
    email TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create chat_sessions table to store different chat conversations
CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Nueva conversación',
    model TEXT NOT NULL,
    is_pinned BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create chat_messages table to store messages within each chat session
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'model')),
    content TEXT,
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file')),
    file_path TEXT, -- Storage path for uploaded/generated files
    file_name TEXT, -- Original filename for downloads
    file_type TEXT, -- MIME type for files
    metadata JSONB DEFAULT '{}'::jsonb, -- For additional data like usage metrics
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON public.chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON public.chat_sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON public.chat_messages(created_at);

-- Create a view for session summaries with message counts
CREATE OR REPLACE VIEW public.chat_session_summaries AS
SELECT 
    cs.id,
    cs.user_id,
    cs.title,
    cs.model,
    cs.is_pinned,
    cs.is_archived,
    cs.created_at,
    cs.updated_at,
    cs.last_message_at,
    (SELECT COUNT(*) FROM public.chat_messages cm WHERE cm.session_id = cs.id) AS message_count,
    (SELECT content FROM public.chat_messages 
     WHERE session_id = cs.id 
     ORDER BY created_at DESC 
     LIMIT 1) AS last_message_preview
FROM public.chat_sessions cs;

-- Functions for managing chat sessions and messages

-- Function to create a new chat session
CREATE OR REPLACE FUNCTION public.create_chat_session(
    p_user_id UUID,
    p_title TEXT,
    p_model TEXT
) RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
BEGIN
    INSERT INTO public.chat_sessions (user_id, title, model)
    VALUES (p_user_id, p_title, p_model)
    RETURNING id INTO v_session_id;
    
    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to add a message to a chat session
CREATE OR REPLACE FUNCTION public.add_chat_message(
    p_session_id UUID,
    p_role TEXT,
    p_content TEXT,
    p_message_type TEXT DEFAULT 'text',
    p_file_path TEXT DEFAULT NULL,
    p_file_name TEXT DEFAULT NULL,
    p_file_type TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
    v_message_id UUID;
BEGIN
    -- Insert the new message
    INSERT INTO public.chat_messages (
        session_id, role, content, message_type, 
        file_path, file_name, file_type, metadata
    )
    VALUES (
        p_session_id, p_role, p_content, p_message_type,
        p_file_path, p_file_name, p_file_type, p_metadata
    )
    RETURNING id INTO v_message_id;
    
    -- Update the last_message_at timestamp in the session
    UPDATE public.chat_sessions
    SET last_message_at = NOW(), updated_at = NOW()
    WHERE id = p_session_id;
    
    RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get chat history for a session
CREATE OR REPLACE FUNCTION public.get_chat_history(p_session_id UUID)
RETURNS TABLE (
    id UUID,
    role TEXT,
    content TEXT,
    message_type TEXT,
    file_path TEXT,
    file_name TEXT,
    file_type TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cm.id,
        cm.role,
        cm.content,
        cm.message_type,
        cm.file_path,
        cm.file_name,
        cm.file_type,
        cm.metadata,
        cm.created_at
    FROM 
        public.chat_messages cm
    WHERE 
        cm.session_id = p_session_id
    ORDER BY 
        cm.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update chat session title
CREATE OR REPLACE FUNCTION public.update_chat_session_title(
    p_session_id UUID,
    p_title TEXT
) RETURNS VOID AS $$
BEGIN
    UPDATE public.chat_sessions
    SET title = p_title, updated_at = NOW()
    WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to toggle pin status
CREATE OR REPLACE FUNCTION public.toggle_chat_session_pin(
    p_session_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_is_pinned BOOLEAN;
BEGIN
    UPDATE public.chat_sessions
    SET is_pinned = NOT is_pinned, updated_at = NOW()
    WHERE id = p_session_id
    RETURNING is_pinned INTO v_is_pinned;
    
    RETURN v_is_pinned;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to archive a chat session
CREATE OR REPLACE FUNCTION public.archive_chat_session(
    p_session_id UUID,
    p_archive BOOLEAN
) RETURNS VOID AS $$
BEGIN
    UPDATE public.chat_sessions
    SET is_archived = p_archive, updated_at = NOW()
    WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to delete a chat session and all its messages
CREATE OR REPLACE FUNCTION public.delete_chat_session(
    p_session_id UUID
) RETURNS VOID AS $$
BEGIN
    DELETE FROM public.chat_sessions
    WHERE id = p_session_id;
    -- Messages will be deleted automatically due to CASCADE
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS (Row Level Security) Policies

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Create policies for users table
CREATE POLICY users_select_policy ON public.users
    FOR SELECT USING (auth.uid()::text = user_id OR auth.uid() = '00000000-0000-0000-0000-000000000000');

CREATE POLICY users_insert_policy ON public.users
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY users_update_policy ON public.users
    FOR UPDATE USING (auth.uid()::text = user_id);

-- Create policies for chat_sessions table
CREATE POLICY chat_sessions_select_policy ON public.chat_sessions
    FOR SELECT USING (
        user_id IN (SELECT id FROM public.users WHERE user_id = auth.uid()::text)
    );

CREATE POLICY chat_sessions_insert_policy ON public.chat_sessions
    FOR INSERT WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE user_id = auth.uid()::text)
    );

CREATE POLICY chat_sessions_update_policy ON public.chat_sessions
    FOR UPDATE USING (
        user_id IN (SELECT id FROM public.users WHERE user_id = auth.uid()::text)
    );

CREATE POLICY chat_sessions_delete_policy ON public.chat_sessions
    FOR DELETE USING (
        user_id IN (SELECT id FROM public.users WHERE user_id = auth.uid()::text)
    );

-- Create policies for chat_messages table
CREATE POLICY chat_messages_select_policy ON public.chat_messages
    FOR SELECT USING (
        session_id IN (
            SELECT id FROM public.chat_sessions 
            WHERE user_id IN (SELECT id FROM public.users WHERE user_id = auth.uid()::text)
        )
    );

CREATE POLICY chat_messages_insert_policy ON public.chat_messages
    FOR INSERT WITH CHECK (
        session_id IN (
            SELECT id FROM public.chat_sessions 
            WHERE user_id IN (SELECT id FROM public.users WHERE user_id = auth.uid()::text)
        )
    );

CREATE POLICY chat_messages_update_policy ON public.chat_messages
    FOR UPDATE USING (
        session_id IN (
            SELECT id FROM public.chat_sessions 
            WHERE user_id IN (SELECT id FROM public.users WHERE user_id = auth.uid()::text)
        )
    );

CREATE POLICY chat_messages_delete_policy ON public.chat_messages
    FOR DELETE USING (
        session_id IN (
            SELECT id FROM public.chat_sessions 
            WHERE user_id IN (SELECT id FROM public.users WHERE user_id = auth.uid()::text)
        )
    );

-- Create a trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_timestamp
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_chat_sessions_timestamp
BEFORE UPDATE ON public.chat_sessions
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Storage configuration for custom-gemini-chat-storage bucket
-- Note: This part needs to be executed in the Supabase dashboard or via the API

-- SQL for storage bucket policies (to be applied after bucket creation)
-- Replace these comments with actual policy creation in the Supabase dashboard

/*
Storage Bucket: custom-gemini-chat-storage

Suggested structure:
- /public/ - For publicly accessible files
- /private/{user_id}/ - For user-specific private files
- /chat/{session_id}/ - For chat-specific files

Storage Policies to create in Supabase dashboard:

1. Allow authenticated users to upload files to their own folders:
   - DOWNLOAD: authenticated, path starts with 'private/' + user ID or 'chat/'
   - INSERT: authenticated, path starts with 'private/' + user ID or 'chat/'
   - UPDATE: authenticated, path starts with 'private/' + user ID
   - DELETE: authenticated, path starts with 'private/' + user ID

2. Allow public access to public folder:
   - DOWNLOAD: path starts with 'public/'
   - INSERT: authenticated
   - UPDATE: authenticated, owner
   - DELETE: authenticated, owner
*/

-- Create a function to generate a storage path for chat files
CREATE OR REPLACE FUNCTION public.generate_chat_storage_path(
    p_user_id UUID,
    p_session_id UUID,
    p_file_name TEXT
) RETURNS TEXT AS $$
DECLARE
    v_path TEXT;
BEGIN
    v_path := 'chat/' || p_session_id || '/' || uuid_generate_v4() || '_' || p_file_name;
    RETURN v_path;
END;
$$ LANGUAGE plpgsql;

-- Create a function to handle user registration/login
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (user_id, email, display_name)
    VALUES (NEW.id::text, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
    ON CONFLICT (user_id) 
    DO UPDATE SET
        email = EXCLUDED.email,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger for new user registration
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create a trigger for user updates
CREATE TRIGGER on_auth_user_updated
AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
