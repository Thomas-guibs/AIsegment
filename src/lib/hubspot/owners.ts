import { hubspotList } from "./client"
import type { HubSpotOwner } from "../types"

export async function fetchOwners(): Promise<HubSpotOwner[]> {
  return hubspotList<HubSpotOwner>("/crm/v3/owners", "owners")
}

export async function getOwnerName(ownerId: string): Promise<string> {
  const owners = await fetchOwners()
  const owner = owners.find((o) => o.id === ownerId)
  return owner ? `${owner.firstName} ${owner.lastName}` : "Unknown"
}
