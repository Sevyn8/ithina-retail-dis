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
    ENV           = "staging"
    DIS_DB_NAME   = var.dis_db_name
    DIS_DB_USER   = var.dis_db_user
    CLOUDSQL_CONN = module.cloud_sql.connection_name
    # CORS points at the frontend URL (admin pattern, 14c explicit origins).
    CORS_ALLOWED_ORIGINS = var.dis_ui_url
    # App-level auth is STUB until real OIDC (D25).
    AUTH_CLIENT_MODE = "STUB"
  }

  secret_env = {
    DIS_DB_PASSWORD = "dis-db-app-password"
    JWT_JWKS        = "dis-jwt-jwks"
  }

  # Public Cloud Run + app-level JWT/CORS auth, matching ithina-retail-admin.
  # REQUIRES the project-level iam.allowedPolicyMemberDomains exemption (allowAll);
  # keep false until set, then flip to true.
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

  # NO runtime env for the frontend: the UI's mode and API base are BUILD-TIME Vite
  # vars (VITE_DIS_UI_SERVER_MODE + VITE_DIS_UI_SERVER_BASE_URL) baked into the static
  # bundle when the dis-ui IMAGE is built, not read at Cloud Run runtime. So making the
  # hosted frontend call the real backend is an image-BUILD concern, not a Terraform env:
  # build the dis-ui image with the cloudbuild substitutions
  #   _DIS_UI_SERVER_MODE=real
  #   _DIS_UI_SERVER_BASE_URL=<dis-ui-server URL>   (= var.dis_ui_server_url, known after
  #                                                   dis-ui-server deploys; second build)
  # (see terraform/docker/cloudbuild.yaml + dis-ui.Dockerfile). The previous runtime
  # VITE_API_BASE env here was dead: the UI never read it, and a runtime var cannot
  # change an already-built SPA. var.dis_ui_server_url now feeds that build substitution.

  # Public Cloud Run + app-level JWT/CORS auth, matching ithina-retail-admin.
  # REQUIRES the project-level iam.allowedPolicyMemberDomains exemption (allowAll);
  # keep false until set, then flip to true.
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
