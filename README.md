# AI Chatbot

A full-stack AI chatbot application with a Python backend and React frontend.

## Project Structure

```
ai-chatbot/
├── backend/                 # Python Flask/FastAPI backend
│   ├── main.py             # Main application entry point
│   ├── requirements.txt     # Python dependencies
│   ├── start.sh           # Backend startup script
│   └── __pycache__/       # Python cache directory
│
└── frontend/              # React frontend application
    └── chat-ui/           # Main chat UI application
        ├── src/           # Source code
        │   ├── App.jsx    # Main App component
        │   ├── Chat.jsx   # Chat component
        │   ├── Login.jsx  # Login component
        │   ├── firebase.js # Firebase configuration
        │   ├── main.jsx   # Entry point
        │   ├── App.css    # App styles
        │   ├── login.css  # Login styles
        │   ├── index.css  # Global styles
        │   └── assets/    # Static assets
        │
        ├── public/        # Public assets
        ├── package.json   # Node dependencies
        ├── vite.config.js # Vite configuration
        ├── eslint.config.js # ESLint configuration
        ├── index.html     # HTML template
        └── README.md      # Frontend readme
```

## Prerequisites

- **Python 3.8+** (for backend)
- **Node.js 14+** (for frontend)
- **npm or yarn** (package managers)

## Installation

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend/chat-ui
```

2. Install Node dependencies:
```bash
npm install
```

## Running the Application

### Start the Backend

1. From the backend directory:
```bash
./start.sh
```

Or run directly with Python:
```bash
python main.py
```

The backend will typically run on `http://localhost:5000` or `http://localhost:8000` (depending on your configuration).

### Start the Frontend

1. From the `frontend/chat-ui` directory:
```bash
npm run dev
```

The frontend will run on `http://localhost:5173` (Vite default).

## Technologies Used

### Backend
- Python
- Flask or FastAPI (based on main.py)

### Frontend
- React (JSX)
- Vite (Build tool)
- Firebase (Authentication)
- CSS

## Features

- Real-time chat interface
- User authentication via Firebase
- AI-powered responses from backend
- Responsive design

## Development

### Frontend Development
- ESLint is configured for code quality
- Vite provides fast hot module replacement (HMR)
- React components structure: App → Chat, Login

### Backend Development
- Python backend handles AI chatbot logic
- API endpoints serve chat requests
- Integration with frontend via REST/WebSocket

## Environment Setup

Make sure to configure any necessary environment variables:
- Backend: Check `main.py` for required configurations
- Frontend: Firebase configuration in `firebase.js`

## Building for Production

### Frontend Build
```bash
cd frontend/chat-ui
npm run build
```

This creates an optimized build in the `dist/` directory.

## Troubleshooting

- **Port already in use**: Check if another process is using the ports and either kill it or configure a different port
- **Dependencies not installing**: Make sure you have the correct Python version and Node.js version installed
- **Firebase errors**: Verify Firebase configuration in `firebase.js` is correct

## License

Please add your license information here.

## Contributing

Please add contribution guidelines here.
