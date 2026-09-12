import { ExcelTaskPane } from '@/components/excel-task-pane'
import { getCurrentWorkspace } from '@/lib/repository/workspace'

export const dynamic='force-dynamic'

export default async function ExcelIntegrationPage(){
 const context=await getCurrentWorkspace()
 return <ExcelTaskPane authenticated={Boolean(context.userId&&context.workspace)} workspaceName={context.workspace?.name}/>
}
