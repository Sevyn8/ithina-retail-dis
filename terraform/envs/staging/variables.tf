###############################################################################
# Core project / location
###############################################################################

variable "project_id" {
  description = "GCP project ID for DIS staging."
  type        = string
  default     = "ithina-retail-dis"
}

variable "project_number" {
  description = "GCP project number (used for some IAM member strings)."
  type        = string
  default     = "1002062049747"
}

variable "region" {
  description = "Primary region for all DIS resources."
  type        = string
  default     = "asia-south1"
}

variable "zone" {
  description = "Zone for zonal resources (the SFTPGo VM)."
  type        = string
  default     = "asia-south1-a"
}

variable "env" {
  description = "Environment name. This project is staging."
  type        = string
  default     = "staging"
}

variable "name_prefix" {
  description = "Prefix for resource names (design convention)."
  type        = string
  default     = "dis"
}

variable "labels" {
  description = "Default labels applied to all resources."
  type        = map(string)
  default = {
    workload    = "dis"
    env         = "staging"
    cost_center = "ithina"
  }
}

###############################################################################
# Networking
###############################################################################

variable "subnet_cidr" {
  description = "Primary subnet CIDR for the DIS VPC."
  type        = string
  default     = "10.20.0.0/24"
}

###############################################################################
# Cloud SQL (Postgres)
###############################################################################

variable "cloud_sql_tier" {
  description = "Cloud SQL machine tier. Smallest viable for staging. NOTE: the legacy db-f1-micro / db-g1-small shared-core tiers are deprecated for newer Postgres versions; the smallest modern tier may be db-custom-1-3840. Confirm for your Postgres version."
  type        = string
  default     = "db-f1-micro"
}

variable "postgres_version" {
  description = "Cloud SQL Postgres version."
  type        = string
  default     = "POSTGRES_16"
}

variable "dis_db_name" {
  description = "The DIS application database name."
  type        = string
  default     = "ithina_dis_db"
}

variable "dis_db_user" {
  description = "The DIS application DB role name (matches infra/local/postgres-init.sql; NOSUPERUSER NOBYPASSRLS in app use)."
  type        = string
  default     = "ithina_dis_user"
}

###############################################################################
# Pub/Sub
###############################################################################

variable "pubsub_topics" {
  description = "Pub/Sub topics to create. Confirm against contracts/pubsub in the app repo."
  type        = list(string)
  default = [
    "csv.received",
    "ingress.ready",
    "ingress.resubmit",
    "identity.changed",
    "mapping.changed",
    "quarantine",
    "pipeline.dlq",
  ]
}

###############################################################################
# Secret Manager (containers only; values set out of band)
###############################################################################

variable "secret_names" {
  description = "Secret Manager secret containers to create. Values are set out of band, never in Terraform."
  type        = list(string)
  default = [
    "dis-db-app-password",
    "dis-cm-mirror-reader-conn",
    "dis-jwt-jwks",
    "dis-gemini-api-key",
  ]
}

###############################################################################
# Artifact Registry
###############################################################################

variable "artifact_repo_id" {
  description = "Artifact Registry Docker repo id for DIS service images."
  type        = string
  default     = "dis-images"
}

###############################################################################
# Cloud Run service images
# Set these AFTER you build and push images. Until then a service can be left
# out of the apply (comment its module) or pointed at a placeholder image.
###############################################################################

variable "image_dis_ui_server" {
  description = "Image URI for dis-ui-server (e.g. asia-south1-docker.pkg.dev/ithina-retail-dis/dis-images/dis-ui-server:TAG)."
  type        = string
  default     = ""
}

variable "image_dis_ui" {
  description = "Image URI for the dis-ui frontend static-server container."
  type        = string
  default     = ""
}

variable "image_csv_ingest_worker" {
  description = "Image URI for csv-ingest-worker (Dockerfile TODO)."
  type        = string
  default     = ""
}

variable "image_streaming_consumer" {
  description = "Image URI for streaming-consumer (Dockerfile TODO)."
  type        = string
  default     = ""
}

variable "image_mirror_sync_consumer" {
  description = "Image URI for mirror-sync-consumer (Dockerfile TODO)."
  type        = string
  default     = ""
}

variable "dis_ui_server_url" {
  description = "Public URL of dis-ui-server, used as the frontend API base and for CORS. Known after dis-ui-server deploys; can be set on a second apply."
  type        = string
  default     = ""
}

###############################################################################
# SFTPGo
###############################################################################

variable "sftpgo_machine_type" {
  description = "Machine type for the SFTPGo GCE VM."
  type        = string
  default     = "e2-small"
}
