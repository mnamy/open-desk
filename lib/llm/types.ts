export type QualificationRisk = "LOW" | "MEDIUM" | "HIGH"

export interface ClassificationInput {
  companyName: string
  title: string
  description: string
  city: string | null
  workArrangement: string
  experienceLabel: string
  experienceBucket: "main" | "stretch" | "reject"
  requiredOrPreferred: string
  industry: string | null
  roleFamily: string
}

export interface Classification {
  opportunityFit: number
  qualificationRisk: QualificationRisk
  whyMatch: string
  stretchReason: string
  roleFamily: string
  contentHash: string
}

export interface JobClassifier {
  classify(input: ClassificationInput): Promise<Classification>
}
