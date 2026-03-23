import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

export interface IConversation extends Document {
  userId: string;
  title: string;
  messages: IMessage[];
  lastUpdated: Date;
}

const ConversationSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, default: 'New Chat' },
  messages: [{
    role: { type: String, enum: ['user', 'model'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }],
  lastUpdated: { type: Date, default: Date.now }
});

ConversationSchema.pre('save', function(next) {
  this.set({ lastUpdated: new Date() });
  next();
});

export default mongoose.model<IConversation>('Conversation', ConversationSchema);
