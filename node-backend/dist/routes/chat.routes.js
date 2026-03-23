"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const chat_controller_1 = require("../controllers/chat.controller");
const router = (0, express_1.Router)();
// /api/chat/stream
router.post('/stream', chat_controller_1.streamChat);
exports.default = router;
