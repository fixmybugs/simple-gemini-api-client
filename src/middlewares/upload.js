import multer from 'multer';
import path from 'path';

// Configuración de multer para manejar múltiples archivos en memoria
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB máximo por archivo
        files: 5, // Máximo 5 archivos
    },
    fileFilter: (req, file, cb) => {
        // Permitir imágenes, PDFs y documentos de texto
        const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|txt|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Tipo de archivo no permitido'));
        }
    }
});

export default upload;
