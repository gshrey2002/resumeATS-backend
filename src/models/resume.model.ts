import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISavedResume extends Document {
  userId: Types.ObjectId;
  name: string;
  latexCode: string;
  lastJobDescription?: string;
  lastOptimizedLatex?: string;
  lastScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

const savedResumeSchema = new Schema<ISavedResume>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    latexCode: { type: String, required: true },
    lastJobDescription: { type: String, default: '' },
    lastOptimizedLatex: { type: String, default: '' },
    lastScore: { type: Number, default: null },
  },
  { timestamps: true }
);

export const SavedResume = mongoose.model<ISavedResume>('SavedResume', savedResumeSchema);
