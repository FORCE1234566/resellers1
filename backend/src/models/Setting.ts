import mongoose, { Document, Schema } from 'mongoose';
import { Network } from './Package';

export interface IComplaintSettings {
  globalEnabled: boolean;
  networkSettings: Record<Network, boolean>;
  userOverrides: Map<string, boolean>;
  activeNotice?: string;
  noticeOverridesComplaints: boolean;
}

export interface IReferralSettings {
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
  isEnabled: boolean;
}

export interface IServiceImage {
  network: Network;
  imageUrl: string;
  isAvailable: boolean;
}

export type FulfillmentProvider = 'smartdatahub' | 'datamax';
export type FulfillmentNetworkRoute = 'default' | FulfillmentProvider | 'off';
export type AfaFulfillmentRoute = 'default' | 'datamax' | 'off';

export interface IFulfillmentSettings {
  /** Master switch — when false, no orders are sent to the external API */
  enabled: boolean;
  defaultProvider: FulfillmentProvider;
  networkRouting: Record<Network, FulfillmentNetworkRoute>;
  /** AFA registration API routing (Datamax register endpoint only) */
  afaRouting: AfaFulfillmentRoute;
}

export interface IAfaSettings {
  inStock: boolean;
  imageUrl?: string;
}

export interface ICheckerTypeSettings {
  inStock: boolean;
  imageUrl?: string;
}

export interface ICheckerSettings {
  bece: ICheckerTypeSettings;
  wassce: ICheckerTypeSettings;
}

export interface IAuthSettings {
  resellerEmailOtpEnabled: boolean;
  agentEmailOtpEnabled: boolean;
}

export interface ISetting extends Document {
  afaSettings?: IAfaSettings;
  checkerSettings?: ICheckerSettings;
  processingFeePercent: number;
  paystackChargePercent: number;
  minWithdrawal: number;
  withdrawalPoolBalance: number;
  totalPoolDeposits: number;
  complaintSettings: IComplaintSettings;
  authSettings?: IAuthSettings;
  referralSettings: IReferralSettings;
  fulfillmentSettings: IFulfillmentSettings;
  serviceImages: IServiceImage[];
  updatedAt: Date;
}

const settingSchema = new Schema<ISetting>(
  {
    afaSettings: {
      inStock: { type: Boolean, default: true },
      imageUrl: String,
    },
    checkerSettings: {
      bece: {
        inStock: { type: Boolean, default: false },
        imageUrl: String,
      },
      wassce: {
        inStock: { type: Boolean, default: false },
        imageUrl: String,
      },
    },
    processingFeePercent: { type: Number, default: 2 },
    paystackChargePercent: { type: Number, default: 2 },
    minWithdrawal: { type: Number, default: 30 },
    withdrawalPoolBalance: { type: Number, default: 0 },
    totalPoolDeposits: { type: Number, default: 0 },
    complaintSettings: {
      globalEnabled: { type: Boolean, default: true },
      networkSettings: {
        MTN: { type: Boolean, default: true },
        Telecel: { type: Boolean, default: true },
        AirtelTigo: { type: Boolean, default: true },
      },
      userOverrides: { type: Map, of: Boolean, default: {} },
      activeNotice: String,
      noticeOverridesComplaints: { type: Boolean, default: false },
    },
    authSettings: {
      resellerEmailOtpEnabled: { type: Boolean, default: true },
      agentEmailOtpEnabled: { type: Boolean, default: true },
    },
    referralSettings: {
      commissionType: { type: String, enum: ['fixed', 'percentage'], default: 'fixed' },
      commissionValue: { type: Number, default: 5 },
      isEnabled: { type: Boolean, default: true },
    },
    fulfillmentSettings: {
      enabled: { type: Boolean, default: true },
      defaultProvider: { type: String, enum: ['smartdatahub', 'datamax'], default: 'smartdatahub' },
      networkRouting: {
        MTN: { type: String, enum: ['default', 'smartdatahub', 'datamax', 'off'], default: 'off' },
        Telecel: { type: String, enum: ['default', 'smartdatahub', 'datamax', 'off'], default: 'smartdatahub' },
        AirtelTigo: { type: String, enum: ['default', 'smartdatahub', 'datamax', 'off'], default: 'off' },
      },
      afaRouting: { type: String, enum: ['default', 'datamax', 'off'], default: 'datamax' },
    },
    serviceImages: [
      {
        network: {
          type: String,
          enum: ['MTN', 'Telecel', 'AirtelTigo'],
        },
        imageUrl: String,
        isAvailable: { type: Boolean, default: true },
      },
    ],
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

export const Setting = mongoose.model<ISetting>('Setting', settingSchema);
