import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { config } from "../config/env.js";

// Managed Identity only - no account key, no SAS, no connection string. Same credential
// chain as src/db/pool.js: ManagedIdentityCredential in Azure, AzureCliCredential locally.
const credential = new DefaultAzureCredential();
const blobServiceClient = new BlobServiceClient(config.storage.accountUrl, credential);

export function getContainerClient(containerName) {
  return blobServiceClient.getContainerClient(containerName);
}

export function getTemplatesContainerClient() {
  return getContainerClient(config.storage.templatesContainer);
}
