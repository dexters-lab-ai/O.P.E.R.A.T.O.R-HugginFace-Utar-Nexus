import mongoose from 'mongoose';
const { Schema } = mongoose;

const userSchema = new Schema({
  email:            { type:String, required:true, unique:true },
  password:         { type:String, required:true },
  openaiApiKey:     { type:String, default:'' },      // legacy single key
  openaiApiKeys:    { type:[String], default: [] },
  defaultKey:       { type:Number,  default: 0 },
  preferredEngine:  { type:String, enum:['gpt-4o-mini','gpt-4o','UITars','qwen-vl-max-latest'], default:'gpt-4o-mini' },
  privacyMode:      { type:Boolean, default:false },
  customUrls:       { type:[String], default: [] }
});

userSchema.index({ email: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
export default User;
