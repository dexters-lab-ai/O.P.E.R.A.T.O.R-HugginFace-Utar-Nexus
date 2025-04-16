import mongoose from 'mongoose';

const chatHistorySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: [{
    role:      { type: String, enum: ['user','assistant','system','function'], required: true },
    content:   { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
  }]
});
chatHistorySchema.index({ userId: 1 });
const ChatHistory = mongoose.model('ChatHistory', chatHistorySchema);
export default ChatHistory;
