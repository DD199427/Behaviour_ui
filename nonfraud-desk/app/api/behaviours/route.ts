import { connection } from "next/server"
import {
  FRAUD_NOTES,
  deviationPhrase,
  enteredByLabel,
  fraudLabel,
  groupDescription,
  type LibraryGroup,
  type LibraryType,
} from "@/lib/behaviour-copy"
import { featureLabel } from "@/lib/groups"
import { getIndex } from "@/lib/index-store"
import { readFraudLibrary } from "@/lib/triage-store"

export async function GET() {
  await connection()
  const library = readFraudLibrary()
  const index = await getIndex()
  const types: LibraryType[] = library.types.map((type) => ({
    id: type.id,
    name: fraudLabel(type.id),
    note: FRAUD_NOTES[type.id] ?? "",
    enteredBy: enteredByLabel(type.enteredBy),
    events: type.events,
    medianDelayDays: type.medianDelayDays,
    medianDurationDays: type.medianDurationDays,
    medianLoss: type.medianLoss,
    totalLoss: type.totalLoss,
  }))
  const groups: LibraryGroup[] = Object.values(index.groups)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((group) => ({
      id: group.id,
      entity: group.entity,
      size: group.size,
      summary: group.summary,
      method: group.method,
      description: groupDescription(group.entity, group.size, group.top),
      suggestedName: `${group.entity}_pattern_${group.id.toLowerCase()}`,
      features: group.top.map((feature) => ({
        feature: featureLabel(feature.feature),
        phrase: deviationPhrase(feature.sd),
        group: feature.group,
        overall: feature.overall,
        sd: feature.sd,
      })),
    }))
  return Response.json({
    events: library.events,
    source: library.source,
    asof: index.asof,
    types,
    groups,
  })
}
