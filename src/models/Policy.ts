import mongoose, { Schema, Document } from 'mongoose';

export interface IPolicy extends Document {
    policyId: string;
    title: string;
    content: string;
    embedding: number[];
}

const PolicySchema: Schema = new Schema({
    policyId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    embedding: { type: [Number], default: [] }
}, { timestamps: true });

export default mongoose.models.Policy || mongoose.model<IPolicy>('Policy', PolicySchema);
