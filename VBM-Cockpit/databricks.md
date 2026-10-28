Here's the end-to-end path for your databricks.yml bundle, from a clean shell to a running app on Lakebase.

1. Verify the CLI
databricks -v      # must be 0.250.0 or above for apps in bundles


Apps-in-bundles support requires CLI 0.250.0+; upgrade if you're below that.

2. Authenticate (U2M OAuth — the right choice for interactive deploys)
databricks auth login \
  --host https://dbc-3255f0de-ed90.cloud.databricks.com \
  --profile ey-dev


The CLI opens a browser, completes the OAuth flow, and writes the profile into ~/.databrickscfg. Tokens are short-lived (<1 hour) and refreshed automatically.

Confirm it took:

databricks auth profiles -o text
databricks auth env --profile ey-dev
databricks current-user me -p ey-dev


For CI later, skip the browser and add an M2M profile with host / client_id / client_secret for a service principal instead.

Note your dev target hardcodes the host — that's correct and intentional, since the CLI resolves workspace.host before variable substitution. Your profile's host must match it, or pass -p / DATABRICKS_HOST to override.

3. Confirm the Lakebase project and database exist

Your bundle points at project masterplancockpit, branch production, database databricks_postgres. Lakebase organizes as project → branch → endpoint/database, and every new project ships with a production branch and a databricks_postgres database.

databricks postgres list-projects -p ey-dev
databricks postgres list-databases <branch> -p ey-dev


If the project doesn't exist, create it with databricks postgres create-project (or via the Lakebase entry in the app switcher) and wait ~1 minute for the compute to become active.

4. Get the warehouse ID
databricks warehouses list -p ey-dev


Your warehouse_id variable defaults to "" so validate won't fail — you must supply it at deploy time.

5. Validate the bundle
databricks bundle validate -t dev -p ey-dev

6. Deploy
databricks bundle deploy -t dev -p ey-dev \
  --var="warehouse_id=<warehouse-id>"


This syncs source_code_path: ./ to the workspace and creates/updates the app plus its bound database and sql-warehouse resources.

Binding the database resource is what makes the platform create the app's service principal, grant it a matching Postgres role, and inject PGHOST / PGPORT / PGDATABASE / PGSSLMODE as environment variables — which is why app.yaml deliberately doesn't set them.

7. Start the app
databricks bundle run cockpit_app -t dev -p ey-dev
databricks bundle summary -t dev -p ey-dev   # prints the app URL
databricks bundle open  -t dev -p ey-dev


Every time you change app code or app.yaml, you must re-run both deploy and run — deploy alone does not restart the app with new source.

8. Verify the Postgres identity

app_entry.py sets PGUSER to DATABRICKS_CLIENT_ID, which is exactly what Lakebase expects as the Postgres role for OAuth auth. Check the app's Environment tab for the DATABRICKS_CLIENT_ID UUID.

If you get a permission error, the service principal's Postgres role is missing. Create it in the Lakebase SQL Editor using the databricks_auth extension — only the project owner's OAuth role is created automatically.

Also confirm in the app's Settings → Resources page that the resource keys read literally database and sql-warehouse, since app.yaml's valueFrom: sql-warehouse resolves against that column by exact name.

9. Local iteration (optional)
databricks apps run-local --prepare-environment --debug


Deploy at least once before running locally — the deploy is what provisions the service principal that owns the app schema. Locally you connect as your identity via databricks postgres generate-database-credential.

Migrating to the client workspace

Replace the literal host under client_prod (it cannot be a variable), authenticate a second profile against their workspace, then:

databricks bundle deploy -t client_prod -p client \
  --var="lakebase_project=<their-project>" \
  --var="lakebase_branch=production" \
  --var="warehouse_id=<their-warehouse-id>"


One gap to close before that handoff: LAKEBASE_INSTANCE_NAME in app.yaml is hardcoded to masterplancockpit, so a client deploy would still point the SDK at your project name. Promote it to valueFrom: database or drive it from ${var.lakebase_project} to keep the migration genuinely flag-only.