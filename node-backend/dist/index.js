"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const chat_routes_1 = __importDefault(require("./routes/chat.routes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5001;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/api/chat', chat_routes_1.default);
// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'live', engine: 'Gemini Pro Node' });
});
// DB Connection & Server Start
mongoose_1.default
    .connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/gemini_chat')
    .then(() => {
    console.log('✅ Connected to MongoDB Atlas');
    app.listen(PORT, () => console.log(`🚀 Server spinning on port ${PORT}`));
})
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));
