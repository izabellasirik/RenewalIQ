/** Real sample submission documents for ABC Transportation LLC (see scripts/generate-sample-fixtures.mjs), served statically and run through the real ingestion pipeline like any broker upload. */
export interface SampleDocumentFixture {
  name: string;
  url: string;
}

export const sampleDocumentFixtures: SampleDocumentFixture[] = [
  { name: 'ABC_Transportation_Client_Questionnaire.docx', url: '/sample-fixtures/ABC_Transportation_Client_Questionnaire.docx' },
  { name: 'ABC_Transportation_Loss_Runs.pdf', url: '/sample-fixtures/ABC_Transportation_Loss_Runs.pdf' },
  { name: 'ABC_Transportation_Vehicle_Schedule.xlsx', url: '/sample-fixtures/ABC_Transportation_Vehicle_Schedule.xlsx' },
  { name: 'ABC_Transportation_Driver_Schedule.xlsx', url: '/sample-fixtures/ABC_Transportation_Driver_Schedule.xlsx' },
  { name: 'ABC_Transportation_Client_Email.txt', url: '/sample-fixtures/ABC_Transportation_Client_Email.txt' },
];
