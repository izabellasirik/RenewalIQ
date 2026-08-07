export interface ApplicationFieldEntry {
  label: string;
  value: string;
  /** dot-path back into the RiskProfile this field was derived from, if any */
  sourceFieldPath?: string;
  editable: boolean;
}

export interface ApplicationSection {
  title: string;
  fields: ApplicationFieldEntry[];
}

export interface ApplicationForm {
  accountId: string;
  generatedAt: string;
  templateName: string;
  sections: ApplicationSection[];
}
