import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:     { type: String, enum: ['user', 'assistant', 'system', 'error', 'thought'], required: true },
  type:     { type: String, enum: ['chat', 'command', 'system', 'error', 'thought'], required: true },
  content:  { type: String, required: true },
  timestamp:{ type: Date, default: Date.now },
  taskId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
});
messageSchema.index({ userId: 1, timestamp: -1 });
const Message = mongoose.model('Message', messageSchema);
export default Message;
