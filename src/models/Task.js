import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  command:           String,
  status:            { type: String, enum: ['pending','processing','completed','error','cancelled'], default: 'pending' },
  progress:          { type: Number, default: 0 },
  startTime:         { type: Date, default: Date.now },
  endTime:           Date,
  cancelledAt:       Date,
  cancellationReason: String,
  result:            mongoose.Schema.Types.Mixed,
  error:             String,
  url:               String,
  runId:             String,
  browserSessionId:  String,  // For tracking active browser sessions
  cleanupAttempted:  { type: Boolean, default: false },
  isComplex:         { type: Boolean, default: false },
  subTasks:          [{ id: String, command: String, status: String, result: mongoose.Schema.Types.Mixed, progress: Number, error: String }],
  intermediateResults:[mongoose.Schema.Types.Mixed],
  plan:              String,
  steps:             [String],
  totalSteps:        Number,
  currentStep:       Number,
  stepMap:           mongoose.Schema.Types.Mixed,
  currentStepDescription: String,
  currentStepFunction:    String,
  currentStepArgs:        mongoose.Schema.Types.Mixed,
  planAdjustment:    String,
  lastAction:        String,
  lastQuery:         String
});
taskSchema.index({ endTime: 1 }, { expireAfterSeconds: 604000 });
const Task = mongoose.model('Task', taskSchema);
export default Task;
