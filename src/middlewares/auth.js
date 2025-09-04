import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware para verificar autenticación
export const requireAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token de autorización requerido' });
        }
        
        const token = authHeader.substring(7);
        
        // Verificar el token con Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ error: 'Token inválido o expirado' });
        }
        
        // Agregar el usuario a la request
        req.user = user;
        next();
        
    } catch (error) {
        console.error('Error en middleware de autenticación:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

// Middleware opcional para rutas que pueden funcionar con o sin autenticación
export const optionalAuth = async (req, res, next) => {
    try {
        // Primero intentar obtener el token del header Authorization
        const authHeader = req.headers.authorization;
        let token = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }
        
        // Si no hay token en el header, intentar obtenerlo de las cookies
        if (!token && req.headers.cookie) {
            const cookies = req.headers.cookie.split(';');
            for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'sb-access-token' || name === 'supabase-auth-token') {
                    token = value;
                    break;
                }
            }
        }
        
        if (token) {
            const { data: { user }, error } = await supabase.auth.getUser(token);
            if (!error && user) {
                req.user = user;
            }
        }
        
        next();
        
    } catch (error) {
        // En caso de error, simplemente continúa sin usuario
        next();
    }
};

export default { requireAuth, optionalAuth };
