import mongoose, { Schema, Document } from 'mongoose';

export interface ITicket extends Document {
    originalText: string;
    safeText: string;
    aiSummary: string;
    retrievedPolicyTitle?: string;
    status: string;
}

const TicketSchema: Schema = new Schema({
    originalText: { type: String, required: true },
    safeText: { type: String, required: true },
    aiSummary: { type: String, required: true },
    retrievedPolicyTitle: { type: String, default: null },
    status: { type: String, default: 'OPEN' }
}, { timestamps: true });

export default mongoose.models.Ticket || mongoose.model<ITicket>('Ticket', TicketSchema);
