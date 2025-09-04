# Simple Google Chat - Aplicación de Chat Multimodal con Gemini

Una aplicación web completa de chat que integra la API de Google Gemini con soporte multimodal para texto, imágenes, documentos y audio. Construida con Node.js, Express, Supabase y una interfaz moderna y responsiva.

## 🚀 Características Principales

### 💬 Chat Inteligente
- **Múltiples modelos de Gemini**: Gemini 1.5 Flash, Gemini Pro, Imagen 2.0, Gemini 2.5 Flash
- **Conversaciones persistentes**: Historial completo guardado en Supabase
- **Respuestas multimodales**: Texto e imágenes generadas por el modelo
- **Gestión de sesiones**: Crear, seleccionar y eliminar chats

### 📁 Soporte Multimodal Completo
- **Imágenes**: Subida y análisis de imágenes (JPG, PNG, GIF, WebP)
- **Documentos**: PDFs, Word, Excel, PowerPoint, archivos de texto
- **Audio**: WAV, MP3, AAC, OGG, FLAC
- **Múltiples archivos**: Hasta 5 archivos por mensaje
- **Almacenamiento seguro**: Supabase Storage con URLs firmadas

### 🎨 Interfaz Moderna
- **Diseño responsivo**: Optimizado para móvil, tablet y desktop
- **UI/UX moderna**: Interfaz limpia con Bulma CSS y Font Awesome
- **Interacción con imágenes**: Zoom, descarga y vista modal
- **Sidebar inteligente**: Navegación fluida entre chats
- **Tema oscuro/claro**: Diseño adaptable

### 🔐 Autenticación y Seguridad
- **Supabase Auth**: Sistema de autenticación completo
- **Row Level Security**: Políticas de seguridad a nivel de base de datos
- **Sesiones seguras**: Gestión de tokens y estados
- **Limpieza automática**: Eliminación completa de recursos al borrar chats

## 🛠️ Tecnologías Utilizadas

- **Backend**: Node.js, Express.js
- **Base de datos**: Supabase (PostgreSQL)
- **Almacenamiento**: Supabase Storage
- **Autenticación**: Supabase Auth
- **IA**: Google Gemini API (@google/genai)
- **Frontend**: EJS, Bulma CSS, Font Awesome
- **Procesamiento**: Multer para archivos

## 📋 Requisitos

- Node.js (v18 o superior)
- Cuenta de Supabase (gratuita)
- Clave de API de Google Gemini ([Google AI Studio](https://aistudio.google.com/))

## 🚀 Instalación y Configuración

### 1. Clonar el repositorio
```bash
git clone <tu-repositorio>
cd simple-google-chat
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno
Crea un archivo `.env` en la raíz del proyecto:

```env
# Google Gemini API
GEMINI_API_KEY=tu_clave_de_gemini_aqui

# Supabase Configuration
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu_clave_anonima_de_supabase

# Storage Configuration
STORAGE_BUCKET=custom-gemini-chat-storage

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 4. Configurar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/)
2. Ejecuta el script SQL de `src/database/supabase_schema.sql` en el SQL Editor
3. Configura las políticas RLS según el archivo de esquema
4. Crea el bucket de storage `custom-gemini-chat-storage`

### 5. Iniciar la aplicación
```bash
npm start
```

La aplicación estará disponible en `http://localhost:3000`

## 📖 Uso de la Aplicación

### Interfaz Web
1. **Registro/Login**: Crea una cuenta o inicia sesión
2. **Crear Chat**: Haz clic en "Nuevo Chat" para comenzar
3. **Seleccionar Modelo**: Elige el modelo de Gemini desde el dropdown
4. **Enviar Mensajes**: Escribe y envía mensajes de texto
5. **Adjuntar Archivos**: Usa los botones para adjuntar imágenes o documentos
6. **Interactuar con Respuestas**: Haz zoom y descarga imágenes generadas

### Funcionalidades Móviles
- **Sidebar responsivo** con botón de cierre
- **Menú de usuario** optimizado para touch
- **Carga de archivos** desde galería o cámara
- **Interfaz adaptable** para todas las pantallas

## 🔌 API Endpoints

### Chat Multimodal
- **URL:** `/api/chat`
- **Método:** `POST`
- **Content-Type:** `multipart/form-data`
- **Headers:** `Authorization: Bearer <token>`
- **Body:**
  - `message` (string): Mensaje de texto
  - `files` (files): Archivos adjuntos (hasta 5)
  - `model` (string): Modelo de Gemini
  - `sessionId` (string): ID de la sesión de chat

### Gestión de Sesiones
- **Crear sesión:** `POST /api/sessions`
- **Listar sesiones:** `GET /api/sessions`
- **Eliminar sesión:** `DELETE /api/sessions/:id`

### Autenticación
- **Login:** `GET /auth/login`
- **Callback:** `GET /auth/callback`
- **Logout:** `POST /auth/logout`

## 🚀 Despliegue en Vercel

### Variables de Entorno en Vercel
```env
GEMINI_API_KEY=tu_clave_de_gemini
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu_clave_anonima
STORAGE_BUCKET=custom-gemini-chat-storage
```

### Configuración Automática
El proyecto incluye `vercel.json` para despliegue automático con:
- Configuración de Node.js 18
- Rutas optimizadas
- Headers de seguridad
- Redirects automáticos

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 🆘 Soporte

Si encuentras algún problema o tienes preguntas:
1. Revisa la documentación
2. Verifica la configuración de Supabase
3. Comprueba las variables de entorno
4. Abre un issue en GitHub

---

**Desarrollado con ❤️ usando Google Gemini API y Supabase, solo lo hice porque quería experimentar con construir mi propio cliente para AI**
