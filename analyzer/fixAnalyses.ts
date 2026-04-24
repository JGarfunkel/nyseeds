import fs from "fs-extra";
import path from "path";

const DATA_DIR = path.resolve("data");

async function main() {
  const realmsData = await fs.readJson(path.join(DATA_DIR, "realms.json"));
  const realms: any[] = realmsData.realms || [];

  for (const realm of realms) {
    const realmDataDir = path.join(DATA_DIR, realm.datapath);
    const entityFilePath = path.join(realmDataDir, realm.entityFile);

    if (!await fs.pathExists(entityFilePath)) {
      console.log(`[${realm.id}] Entity file not found: ${entityFilePath}, skipping.`);
      continue;
    }

    const entityData = await fs.readJson(entityFilePath);
    const entities: any[] = entityData.entities || entityData.municipalities || entityData["school-districts"] || [];
    const entityMap = new Map<string, any>(entities.map((e: any) => [e.id, e]));

    const domains: string[] = realm.domains || [];

    for (const domainId of domains) {
      const domainDir = path.join(realmDataDir, domainId);

      if (!await fs.pathExists(domainDir)) {
        console.log(`  [${realm.id}/${domainId}] Domain folder not found, skipping.`);
        continue;
      }

      const entries = await fs.readdir(domainDir, { withFileTypes: true });
      const entityFolders = entries.filter(e => e.isDirectory());

      for (const folder of entityFolders) {
        const analysisPath = path.join(domainDir, folder.name, "analysis.json");

        if (!await fs.pathExists(analysisPath)) {
          continue;
        }

        console.log(`Reading: ${path.relative(DATA_DIR, analysisPath)}`);

        const analysis = await fs.readJson(analysisPath);
        const municipality = analysis.municipality;

        if (!municipality) {
          continue;
        }

        if (typeof municipality.displayName === "string" && municipality.displayName.startsWith("undefined")) {
          const entityId = municipality.id;
          const entity = entityMap.get(entityId);

          if (!entity) {
            console.log(`  -> WARNING: No entity found for id "${entityId}" in realm "${realm.id}"`);
            continue;
          }

          const newDisplayName = entity.displayName;
          console.log(`  -> Replacing displayName: "${municipality.displayName}" -> "${newDisplayName}"`);

          analysis.municipality.displayName = newDisplayName;
          await fs.writeJson(analysisPath, analysis, { spaces: 2 });
        }
      }
    }
  }

  console.log("\nDone.");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
