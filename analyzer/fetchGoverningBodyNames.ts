// analyzer/fetchGoverningBodyNames.ts
// Script to fetch governing body names for entities with a governingUrl but missing governingBody

// Placeholder imports - update with actual paths if needed
import { getDefaultStorage, downloadFromUrlAnyType, Entity } from '@civillyengaged/ordinizer-analyzer';

async function fetchGoverningBodyNames(realmId: string, requestedEntityList: string[] | null = null) {
  const storage = getDefaultStorage(realmId);

  // Get all entities
  const entities = await storage.getEntities();

  for (const entity of entities) {
    if (!requestedEntityList || requestedEntityList.includes(entity.name)) {
      await updateEntity(entity);
    }
  }

  // Save updated entities
  await storage.saveEntities(entities);
  console.log('Entities updated and saved.');
}

async function updateEntity(entity: Entity) {
    console.log("Processing entity:", entity.name);
    if (entity.governingUrl && (!entity.governingBody || entity.governingBody.trim() === '')) {
      try {
        // Download the page content
        console.log("Fetching entity governing body:", entity.name, "from URL:", entity.governingUrl);
        const htmlBuffer = await downloadFromUrlAnyType(entity.governingUrl);
        const html = htmlBuffer.data.toString('utf-8');
        console.log(`Fetched content for ${entity.name} (length: ${html.length} characters)`);
        // Extract the <title> tag

        const titleMatch = html.match(/<title>(.*?)<\/title>/i);
        if (titleMatch) {
          let title = titleMatch[1];
          // Remove patterns like "${entity.name} ${entity.type}" and "${entity.type} of ${entity.name}"
          const patterns = [
            new RegExp(`${entity.name} ${entity.type}`, 'i'),
            new RegExp(`${entity.type} of ${entity.name}`, 'i'),
            new RegExp(`${entity.type} of ${entity.name}, ${entity.state}`, 'i'),
            new RegExp(`${entity.name}`, 'i'),
          ];
          for (const pattern of patterns) {
            title = title.replace(pattern, '');
          }
          // Remove separators: '|', ' - ', ','
          title = title.replace(/[|,]/g, ' ');
          title = title.replace(/ - /g, ' ');
          // Remove multiple spaces and trim
          let governingBody = title.replace(/\s+/g, ' ').trim();
          entity.governingBody = governingBody;
          console.log(`Updated: ${entity.name} -> ${governingBody}`);
        } else {
          console.warn(`No <title> found for ${entity.name}`);
        }
      } catch (err) {
        console.error(`Failed to fetch for ${entity.name}:`, err);
      }
    }

}


// Run the script if executed directly
const realmId = process.env.CURRENT_REALM || process.argv[2];
if (!realmId) {
console.error('Please provide a realmId as the first argument.');
process.exit(1);
}

const requestedEntityList = process.argv[3] ? process.argv[3].split(',') : null; // Optional comma-separated list of entity names to update    

console.log("Starting fetchGoverningBodyNames for realm:", realmId, "with requestedEntityList:", requestedEntityList);

fetchGoverningBodyNames(realmId, requestedEntityList);
