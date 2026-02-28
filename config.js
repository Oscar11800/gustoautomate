const SHEET_PROFILES = {
  a: {
    name: 'Sheet A (gid=1879732679)',
    urlFragment: 'docs.google.com/spreadsheets/d/1gBryReeOb7g8zQBcmXZfL57p-kbcC-gC_xkCF_qqoFY',
    gid: '1879732679',
    columns: { fullName: 'D', email: 'F', status: 'O', gustoCompleted: 'P' },
    statusValue: 'Yes',
    completedYes: 'YES',
    completedNo: 'NO',
  },
  b: {
    name: 'Sheet B (gid=208364001)',
    urlFragment: 'docs.google.com/spreadsheets/d/1gBryReeOb7g8zQBcmXZfL57p-kbcC-gC_xkCF_qqoFY',
    gid: '208364001',
    columns: { fullName: 'D', email: 'F', status: 'P', gustoCompleted: 'Q' },
    statusValue: 'YES',
    completedYes: 'YES',
    completedNo: 'NO',
  },
};

const profileKey = process.argv.includes('--sheet-b') ? 'b' : 'a';
const activeSheet = SHEET_PROFILES[profileKey];

export const CONFIG = {
  cdpUrl: 'http://127.0.0.1:9222',

  sheets: {
    urlFragment: activeSheet.urlFragment,
    columns: activeSheet.columns,
    statusValue: activeSheet.statusValue,
    completedYes: activeSheet.completedYes,
    completedNo: activeSheet.completedNo,
    profileName: activeSheet.name,
  },

  gusto: {
    urlFragment: 'app.gusto.com',
    allPeopleUrl: 'https://app.gusto.com/people/all',
    onboardingUrl: 'https://app.gusto.com/people/onboarding',
    contractStartDate: { month: '02', day: '17', year: '2026' },
    wageType: 'Fixed',
  },

  delays: {
    actionMin: 50,
    actionMax: 100,
    typeMin: 10,
    typeMax: 30,
    pageTransition: 100,
    betweenContractors: 0,
    batchSize: 10,
    batchPause: 6000,
  },
};
