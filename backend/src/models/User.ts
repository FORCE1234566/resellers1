import mongoose, { Document, Schema } from 'mongoose';

export type UserRole = 'admin' | 'agent' | 'reseller';
export type UserStatus = 'active' | 'suspended' | 'pending';
export type AgentApiApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface IResellerStore {
  storeName: string;
  slug: string;
  phone: string;
  whatsapp: string;
  /** Optional WhatsApp channel or community invite URL for customer updates. */
  whatsappChannelUrl?: string;
  supportEmail: string;
  isActive: boolean;
  isVerified: boolean;
  referralCode: string;
  referredBy?: mongoose.Types.ObjectId;
  /** Floor prices assigned by parent reseller (packageId → price). */
  parentAssignedPrices: Map<string, number>;
  /** Max sell ceiling assigned by parent reseller (packageId → price). */
  parentAssignedMaxPrices: Map<string, number>;
  /** Default floor prices for new sub-resellers (parent template). */
  subResellerDefaultFloors: Map<string, number>;
  /** Default max prices for new sub-resellers (parent template). */
  subResellerDefaultMaxes: Map<string, number>;
  storeDescription?: string;
  customPrices: Map<string, number>;
}

export interface IAgentApi {
  apiKey?: string;
  /** Plaintext kept select:false for agent dashboard display; secretKeyHash used for API auth */
  secretKey?: string;
  secretKeyHash?: string;
  ipWhitelist: string[];
  webhookUrl?: string;
  isActive: boolean;
  approvalStatus?: AgentApiApprovalStatus;
  requestMessage?: string;
  requestedAt?: Date;
  reviewedAt?: Date;
  rejectionReason?: string;
  customPrices?: Map<string, number>;
}

export interface IUser extends Document {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: UserRole;
  status: UserStatus;
  resellerStore?: IResellerStore;
  agentApi?: IAgentApi;
  complaintEnabled: boolean;
  /** When false, login/signup skips email OTP (if global role OTP is on). */
  emailOtpEnabled: boolean;
  isSuperAdmin?: boolean;
  totpEnabled: boolean;
  totpSecretEnc?: string;
  tokenVersion: number;
  failedLoginAttempts: number;
  loginLockedUntil?: Date;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const resellerStoreSchema = new Schema<IResellerStore>(
  {
    storeName: { type: String, required: true },
    slug: { type: String, required: true, lowercase: true },
    phone: { type: String, required: true },
    whatsapp: { type: String, required: true },
    whatsappChannelUrl: { type: String, trim: true, default: '' },
    supportEmail: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: true },
    referralCode: { type: String, required: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    parentAssignedPrices: { type: Map, of: Number, default: {} },
    parentAssignedMaxPrices: { type: Map, of: Number, default: {} },
    subResellerDefaultFloors: { type: Map, of: Number, default: {} },
    subResellerDefaultMaxes: { type: Map, of: Number, default: {} },
    storeDescription: { type: String, default: '' },
    customPrices: { type: Map, of: Number, default: {} },
  },
  { _id: false }
);

const agentApiSchema = new Schema<IAgentApi>(
  {
    apiKey: String,
    secretKey: { type: String, select: false },
    secretKeyHash: { type: String, select: false },
    ipWhitelist: { type: [String], default: [] },
    webhookUrl: String,
    isActive: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
    },
    requestMessage: String,
    requestedAt: Date,
    reviewedAt: Date,
    rejectionReason: String,
    customPrices: { type: Map, of: Number, default: {} },
  },
  { _id: false }
);

const userSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'agent', 'reseller'], required: true },
    status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'active' },
    resellerStore: resellerStoreSchema,
    agentApi: agentApiSchema,
    complaintEnabled: { type: Boolean, default: true },
    emailOtpEnabled: { type: Boolean, default: true },
    isSuperAdmin: { type: Boolean, default: false },
    totpEnabled: { type: Boolean, default: false },
    totpSecretEnc: { type: String, select: false },
    tokenVersion: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0 },
    loginLockedUntil: Date,
    lastLogin: Date,
  },
  { timestamps: true }
);

userSchema.index({ 'resellerStore.slug': 1 }, { unique: true, sparse: true });
userSchema.index({ 'resellerStore.referralCode': 1 }, { unique: true, sparse: true });
userSchema.index({ 'resellerStore.referredBy': 1 }, { sparse: true });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ role: 1, 'resellerStore.isActive': 1 });
userSchema.index({ role: 1, 'agentApi.approvalStatus': 1 });

export const User = mongoose.model<IUser>('User', userSchema);
