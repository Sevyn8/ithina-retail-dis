# DIS service images

Dockerfiles for the DIS services plus a Cloud Build pipeline. These are modeled
on the established pattern (the existing services/dis-ui-server/Dockerfile and
the repo's uv / pnpm tooling). CONFIRM the per-service entrypoints against each
service's real module before relying on them.

## The services

| Image | Dockerfile | Kind | Build context |
|---|---|---|---|
| dis-ui-server | services/dis-ui-server/Dockerfile (existing) | HTTP (BFF) | repo root |
| csv-ingest-worker | docker/csv-ingest-worker.Dockerfile | Pub/Sub consumer | repo root |
| streaming-consumer | docker/streaming-consumer.Dockerfile | Pub/Sub consumer | repo root |
| mirror-sync-consumer | docker/mirror-sync-consumer.Dockerfile | consumer | repo root |
| dis-ui | docker/dis-ui.Dockerfile | static SPA (nginx) | services/dis-ui |

The three workers build from the REPO ROOT because the Python workspace uses
shared libs/ and a root uv.lock. The frontend builds from services/dis-ui (its
own package root with pnpm-lock.yaml).

## What to confirm

- Entrypoints: each worker CMD assumes `python -m <pkg>.main`. Check the real
  module (some services may have a console script or a runner instead).
- Python version: assumed 3.12. Confirm against the root pyproject.toml.
- uv workspace package names: the `--package NAME` flags assume the package
  names match the service dirs. Confirm against pyproject.toml.
- The frontend VITE_API_BASE is a BUILD-time var (baked into the Vite bundle),
  so it must be passed as a build arg, not just a runtime env.

## Build all images (Cloud Build)

From the repo root:

```
gcloud builds submit --config docker/cloudbuild.yaml \
  --substitutions=_REGION=asia-south1,_REPO=dis-images,_API_BASE=https://dis-ui-server-XXXX.run.app .
```

This builds and pushes all five images tagged with the commit short SHA and
:latest. Then set the image_* variables in the Terraform tfvars to the pushed
URIs (by SHA for reproducibility) and apply the service layer.

## Build a single image locally

```
# a worker (from repo root)
docker build -f docker/csv-ingest-worker.Dockerfile -t LOCAL/csv-ingest-worker .

# the frontend (from repo root, context is the frontend dir)
docker build -f docker/dis-ui.Dockerfile --build-arg VITE_API_BASE=URL -t LOCAL/dis-ui services/dis-ui
```
