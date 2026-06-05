###############################################################################
# DIS staging: module wiring.
#
# Durable layer (always applies): project-services, network, service-accounts,
# cloud-sql, buckets, pubsub, secrets, artifact-registry.
#
# Service layer (applies once you set the image_* vars): the Cloud Run services
# and the SFTPGo VM. Each Cloud Run service is guarded so it is skipped while
# its image var is empty, letting you bring the durable layer up first.
###############################################################################

# --- Durable layer ---------------------------------------------------------

module "project_services" {
  source     = "../../modules/project-services"
  project_id = var.project_id
}

module "network" {
  source      = "../../modules/network"
  project_id  = var.project_id
  region      = var.region
  name_prefix = var.name_prefix
  subnet_cidr = var.subnet_cidr

  depends_on = [module.project_services]
}

module "service_accounts" {
  source      = "../../modules/service-accounts"
  project_id  = var.project_id
  name_prefix = var.name_prefix

  depends_on = [module.project_services]
}

module "secrets" {
  source       = "../../modules/secrets"
  project_id   = var.project_id
  secret_names = var.secret_names

  depends_on = [module.project_services]
}

module "cloud_sql" {
  source                     = "../../modules/cloud-sql"
  project_id                 = var.project_id
  region                     = var.region
  name_prefix                = var.name_prefix
  tier                       = var.cloud_sql_tier
  postgres_version           = var.postgres_version
  db_name                    = var.dis_db_name
  db_user                    = var.dis_db_user
  db_user_password           = module.secrets.db_app_password
  network_id                 = module.network.network_id
  private_service_connection = module.network.private_service_connection
}

module "buckets" {
  source      = "../../modules/buckets"
  project_id  = var.project_id
  region      = var.region
  name_prefix = var.name_prefix

  depends_on = [module.project_services]
}

module "pubsub" {
  source      = "../../modules/pubsub"
  project_id  = var.project_id
  name_prefix = var.name_prefix
  topics      = var.pubsub_topics

  depends_on = [module.project_services]
}

module "artifact_registry" {
  source     = "../../modules/artifact-registry"
  project_id = var.project_id
  region     = var.region
  repo_id    = var.artifact_repo_id

  depends_on = [module.project_services]
}

# --- Service layer ----------------------------------------------------------
# Each service is instantiated only when its image var is non-empty.

module "dis_ui_server" {
  source = "../../modules/cloud-run-service"
  count  = var.image_dis_ui_server == "" ? 0 : 1

  project_id               = var.project_id
  region                   = var.region
  name                     = "${var.name_prefix}-ui-server"
  image                    = var.image_dis_ui_server
  service_account_email    = module.service_accounts.emails["ui-server"]
  vpc_connector_id         = module.network.vpc_connector_id
  cloudsql_connection_name = module.cloud_sql.connection_name

  env = {
    ENV            = "staging"
    DIS_DB_NAME    = var.dis_db_name
    DIS_DB_USER    = var.dis_db_user
    CLOUDSQL_CONN  = module.cloud_sql.connection_name
  }

  secret_env = {
    DIS_DB_PASSWORD = "dis-db-app-password"
    JWT_JWKS        = "dis-jwt-jwks"
  }

  # Staging demo access. If domain-restricted-sharing org policy blocks public
  # invokers, set false and front with IAP / an LB.
  allow_public = true
}

module "dis_ui" {
  source = "../../modules/cloud-run-service"
  count  = var.image_dis_ui == "" ? 0 : 1

  project_id            = var.project_id
  region                = var.region
  name                  = "${var.name_prefix}-ui"
  image                 = var.image_dis_ui
  service_account_email = module.service_accounts.emails["ui-frontend"]

  env = {
    # The frontend's API base. Set dis_ui_server_url after dis-ui-server deploys.
    VITE_API_BASE = var.dis_ui_server_url
  }

  allow_public = true
}

module "csv_ingest_worker" {
  source = "../../modules/cloud-run-service"
  count  = var.image_csv_ingest_worker == "" ? 0 : 1

  project_id               = var.project_id
  region                   = var.region
  name                     = "${var.name_prefix}-csv-ingest-worker"
  image                    = var.image_csv_ingest_worker
  service_account_email    = module.service_accounts.emails["csv-ingest-worker"]
  vpc_connector_id         = module.network.vpc_connector_id
  cloudsql_connection_name = module.cloud_sql.connection_name

  env = {
    ENV = "staging"
  }
  secret_env = {
    DIS_DB_PASSWORD = "dis-db-app-password"
  }
  allow_public = false
}

module "streaming_consumer" {
  source = "../../modules/cloud-run-service"
  count  = var.image_streaming_consumer == "" ? 0 : 1

  project_id               = var.project_id
  region                   = var.region
  name                     = "${var.name_prefix}-streaming-consumer"
  image                    = var.image_streaming_consumer
  service_account_email    = module.service_accounts.emails["streaming-consumer"]
  vpc_connector_id         = module.network.vpc_connector_id
  cloudsql_connection_name = module.cloud_sql.connection_name

  env = {
    ENV = "staging"
  }
  secret_env = {
    DIS_DB_PASSWORD = "dis-db-app-password"
  }
  allow_public = false
}

module "mirror_sync_consumer" {
  source = "../../modules/cloud-run-service"
  count  = var.image_mirror_sync_consumer == "" ? 0 : 1

  project_id               = var.project_id
  region                   = var.region
  name                     = "${var.name_prefix}-mirror-sync-consumer"
  image                    = var.image_mirror_sync_consumer
  service_account_email    = module.service_accounts.emails["mirror-sync-consumer"]
  vpc_connector_id         = module.network.vpc_connector_id
  cloudsql_connection_name = module.cloud_sql.connection_name

  env = {
    ENV = "staging"
  }
  secret_env = {
    DIS_DB_PASSWORD       = "dis-db-app-password"
    CM_MIRROR_READER_CONN = "dis-cm-mirror-reader-conn"
  }
  allow_public = false
}

# --- SFTPGo VM (scaffold; refine with Sanjeev) ------------------------------

module "sftpgo" {
  source = "../../modules/sftpgo-vm"

  project_id            = var.project_id
  region                = var.region
  zone                  = var.zone
  name_prefix           = var.name_prefix
  machine_type          = var.sftpgo_machine_type
  network_id            = module.network.network_id
  subnet_id             = module.network.subnet_id
  service_account_email = module.service_accounts.emails["sftpgo"]
  upload_bucket         = module.buckets.names["upload"]
}
