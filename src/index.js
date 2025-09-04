import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import chatRoutes from './routes/chat.routes.js';
import authRoutes from './routes/auth.routes.js';
import { optionalAuth } from './middlewares/auth.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurar EJS como motor de plantillas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rutas
app.use('/api', chatRoutes);
app.use('/auth', authRoutes);

// Ruta principal - la autenticación se maneja en el cliente
app.get('/', (req, res) => {
    res.render('chat', {
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseKey: process.env.SUPABASE_ANON_KEY,
        process: { env: process.env }
    });
});

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});
