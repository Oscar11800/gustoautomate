export const CONFIG = {
  cdpUrl: 'http://127.0.0.1:9222',

  sheets: {
    urlFragment: 'docs.google.com/spreadsheets/d/1gBryReeOb7g8zQBcmXZfL57p-kbcC-gC_xkCF_qqoFY',
    columns: {
      fullName: 'D',
      email: 'F',
      status: 'O',
    },
    statusValue: 'Yes',
  },

  gusto: {
    urlFragment: 'app.gusto.com',
    contractStartDate: { month: '02', day: '17', year: '2026' },
    wageType: 'Fixed',
  },

  delays: {
    actionMin: 50,
    actionMax: 100,
    typeMin: 10,
    typeMax: 30,
    pageTransition: 100,
    betweenContractors: 1000,  // ms pause between contractor workflows to avoid server throttling
  },
};
