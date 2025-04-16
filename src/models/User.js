// src/models/User.js
import mongoose from 'mongoose';
const { Schema } = mongoose;

const userSchema = new Schema({
  email:           { type: String, required: true, unique: true },
  password:        { type: String, required: true },
  customUrls:      [String],
  preferredEngine: { type: String, enum: ['midscene','browserbase','browseruse'], default: 'midscene' },
  openaiApiKey:    { type: String, default: '' }
});

userSchema.index({ email: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
export default User;
