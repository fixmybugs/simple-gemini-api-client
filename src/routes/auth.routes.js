import { Router } from 'express';

const router = Router();

// Ruta para mostrar la página de login
router.get('/login', (req, res) => {
    res.render('login', {
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_ANON_KEY
    });
});

// Ruta para logout (simplemente redirige al login)
router.get('/logout', (req, res) => {
    res.redirect('/auth/login');
});

export default router;
