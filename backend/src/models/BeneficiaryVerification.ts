import mongoose, { Document, Schema } from 'mongoose';
import { Network } from './Package';

export type BeneficiaryVerificationStatus = 'submitted_for_verification' | 'verified';

export interface IBeneficiaryVerification extends Document {
  phone: string;
  network: Network | string;
  status: BeneficiaryVerificationStatus;
  submittedAt: Date;
  verifiedAt?: Date;
  lastOrderId?: string;
  verificationEmailSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const beneficiaryVerificationSchema = new Schema<IBeneficiaryVerification>(
  {
    phone: { type: String, required: true, index: true },
    network: { type: String, required: true },
    status: {
      type: String,
      enum: ['submitted_for_verification', 'verified'],
      default: 'submitted_for_verification',
      required: true,
    },
    submittedAt: { type: Date, required: true, default: Date.now },
    verifiedAt: Date,
    lastOrderId: String,
    verificationEmailSentAt: Date,
  },
  { timestamps: true }
);

beneficiaryVerificationSchema.index({ phone: 1, network: 1 }, { unique: true });
beneficiaryVerificationSchema.index({ status: 1, submittedAt: 1 });

export const BeneficiaryVerification = mongoose.model<IBeneficiaryVerification>(
  'BeneficiaryVerification',
  beneficiaryVerificationSchema
);
