export class InvestigationAlreadyRunningError extends Error {
 constructor(){super('A review is already running. Wait for it to finish before retrying.');this.name='InvestigationAlreadyRunningError'}
}
