import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:     { type: String, enum: ['user', 'assistant'], required: true },
  type:     { type: String, enum: ['chat', 'command'], required: true },
  content:  { type: String, required: true },
  timestamp:{ type: Date, default: Date.now },
  taskId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
  meta:     { type: Object, default: {} }
});
messageSchema.index({ userId: 1, timestamp: -1 });
const Message = mongoose.model('Message', messageSchema);
export default Message;
