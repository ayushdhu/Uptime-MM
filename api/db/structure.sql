SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: consumable_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consumable_source AS ENUM (
    'uptime_changed',
    'date_read_from_part',
    'unknown'
);


--
-- Name: consumable_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consumable_type AS ENUM (
    'fuel_filter',
    'air_filter',
    'hydraulic_filter',
    'cabin_filter',
    'engine_oil',
    'hydraulic_oil',
    'belt_pto',
    'belt_ac',
    'belt_alternator',
    'other'
);


--
-- Name: drive_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.drive_type AS ENUM (
    'wheeled',
    'tracked'
);


--
-- Name: emissions_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.emissions_tier AS ENUM (
    'tier_3',
    'tier_4'
);


--
-- Name: inspection_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inspection_status AS ENUM (
    'in_progress',
    'completed',
    'locked'
);


--
-- Name: inspection_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.inspection_type AS ENUM (
    'walkthrough',
    'pm_100hr',
    'baseline'
);


--
-- Name: machine_class; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.machine_class AS ENUM (
    'skid_steer',
    'wheel_loader',
    'excavator',
    'dozer',
    'farm_tractor'
);


--
-- Name: note_author_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.note_author_role AS ENUM (
    'technician',
    'admin',
    'owner'
);


--
-- Name: payment_terms; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.payment_terms AS ENUM (
    'due_on_receipt',
    'net_30',
    'net_60'
);


--
-- Name: result_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.result_type AS ENUM (
    'tiered',
    'pass_fail',
    'measurement'
);


--
-- Name: retention_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.retention_state AS ENUM (
    'full',
    'thumbnail_only'
);


--
-- Name: service_cadence; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_cadence AS ENUM (
    'weekly',
    'biweekly',
    'monthly'
);


--
-- Name: severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.severity AS ENUM (
    'low',
    'medium',
    'high'
);


--
-- Name: signature_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.signature_type AS ENUM (
    'visit_checkout',
    'high_severity_ack'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'technician',
    'senior_technician',
    'admin',
    'owner'
);


--
-- Name: uptime_guard_inspection(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_guard_inspection() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'locked' THEN
      RAISE EXCEPTION 'inspection % is locked and cannot be deleted', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'locked' THEN
    IF (to_jsonb(OLD) - 'synced_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'synced_at' - 'updated_at') THEN
      RAISE EXCEPTION 'inspection % is locked; only synced_at may be set', OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: uptime_guard_inspection_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_guard_inspection_item() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_inspection_id uuid;
BEGIN
  v_inspection_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.inspection_id ELSE NEW.inspection_id END;
  IF uptime_inspection_locked(v_inspection_id) OR (TG_OP = 'UPDATE' AND uptime_inspection_locked(OLD.inspection_id)) THEN
    RAISE EXCEPTION 'inspection % is locked; inspection_items are immutable', v_inspection_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: uptime_guard_photo(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_guard_photo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_item_id uuid;
  v_inspection_id uuid;
BEGIN
  v_item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.inspection_item_id ELSE NEW.inspection_item_id END;
  SELECT inspection_id INTO v_inspection_id FROM inspection_items WHERE id = v_item_id;
  IF uptime_inspection_locked(v_inspection_id) THEN
    IF TG_OP = 'UPDATE' AND OLD.inspection_item_id = NEW.inspection_item_id AND
       (to_jsonb(OLD) - 'uploaded_at' - 'retention_state' - 's3_url' - 'thumbnail_s3_key' - 'updated_at')
       IS NOT DISTINCT FROM
       (to_jsonb(NEW) - 'uploaded_at' - 'retention_state' - 's3_url' - 'thumbnail_s3_key' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'inspection % is locked; photos are immutable', v_inspection_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: uptime_guard_signature(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_guard_signature() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_inspection_id uuid;
BEGIN
  v_inspection_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.inspection_id ELSE NEW.inspection_id END;
  IF uptime_inspection_locked(v_inspection_id) OR (TG_OP = 'UPDATE' AND uptime_inspection_locked(OLD.inspection_id)) THEN
    RAISE EXCEPTION 'inspection % is locked; signatures are immutable', v_inspection_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: uptime_inspection_locked(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_inspection_locked(p_inspection_id uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT EXISTS (SELECT 1 FROM inspections WHERE id = p_inspection_id AND status = 'locked');
$$;


--
-- Name: uptime_mark_inspection_synced(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_mark_inspection_synced(p_inspection_id uuid, p_synced_at timestamp with time zone) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE inspections SET synced_at = p_synced_at, updated_at = now() WHERE id = p_inspection_id;
$$;


--
-- Name: uptime_mark_photo_uploaded(uuid, timestamp with time zone, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_mark_photo_uploaded(p_photo_id uuid, p_uploaded_at timestamp with time zone, p_thumbnail_key text) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE photos SET uploaded_at = p_uploaded_at, thumbnail_s3_key = COALESCE(p_thumbnail_key, thumbnail_s3_key), updated_at = now()
  WHERE id = p_photo_id;
$$;


--
-- Name: uptime_reject_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_reject_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION '% is append only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;


--
-- Name: uptime_set_photo_retention(uuid, public.retention_state); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.uptime_set_photo_retention(p_photo_id uuid, p_state public.retention_state) RETURNS void
    LANGUAGE sql
    AS $$
  UPDATE photos SET retention_state = p_state, updated_at = now() WHERE id = p_photo_id;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_id character varying NOT NULL,
    token_digest character varying NOT NULL,
    last_used_at timestamp(6) without time zone,
    revoked_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: ar_internal_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_internal_metadata (
    key character varying NOT NULL,
    value character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: checklist_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_class public.machine_class NOT NULL,
    drive_type public.drive_type,
    has_def boolean,
    version character varying NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    published_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: consumable_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumable_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_id uuid NOT NULL,
    inspection_id uuid,
    consumable_type public.consumable_type NOT NULL,
    changed_at date,
    hour_meter_at_change integer,
    source public.consumable_source DEFAULT 'unknown'::public.consumable_source NOT NULL,
    interval_hours integer,
    note text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: customer_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    billing_address text,
    site_address text,
    contact_name character varying,
    contact_phone character varying,
    contact_email character varying,
    service_cadence public.service_cadence DEFAULT 'weekly'::public.service_cadence NOT NULL,
    payment_terms public.payment_terms DEFAULT 'due_on_receipt'::public.payment_terms NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: discrepancy_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discrepancy_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_id uuid NOT NULL,
    inspection_a_id uuid NOT NULL,
    inspection_b_id uuid NOT NULL,
    reviewed_at timestamp(6) without time zone,
    reviewed_by_user_id uuid,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: high_severity_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.high_severity_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_item_id uuid NOT NULL,
    machine_id uuid NOT NULL,
    opened_at timestamp(6) without time zone NOT NULL,
    conversation_checklist jsonb DEFAULT '{}'::jsonb NOT NULL,
    machine_out_of_service boolean NOT NULL,
    recheck_interval_days integer,
    repair_plan text,
    owner_signature_id uuid NOT NULL,
    resolved_at timestamp(6) without time zone,
    resolved_by_user_id uuid,
    resolved_in_inspection_id uuid,
    resolution_note text,
    client_generated_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT high_severity_events_recheck_required_when_in_service CHECK ((machine_out_of_service OR (recheck_interval_days IS NOT NULL)))
);


--
-- Name: inspection_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid NOT NULL,
    template_item_key character varying NOT NULL,
    "position" integer NOT NULL,
    component_name character varying NOT NULL,
    result_type public.result_type NOT NULL,
    severity public.severity,
    pass boolean,
    measurement_value numeric(12,3),
    measurement_unit character varying,
    measurement_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    technician_note text,
    skipped boolean DEFAULT false NOT NULL,
    skip_reason text,
    carried_forward_from_item_id uuid,
    client_generated_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT inspection_items_skip_reason_required CHECK (((NOT skipped) OR (skip_reason IS NOT NULL)))
);


--
-- Name: inspection_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid NOT NULL,
    inspection_item_id uuid,
    author_user_id uuid NOT NULL,
    author_role public.note_author_role NOT NULL,
    body text NOT NULL,
    client_generated_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: inspection_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspection_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid NOT NULL,
    s3_key character varying NOT NULL,
    sha256 character varying(64) NOT NULL,
    byte_size bigint NOT NULL,
    page_count integer NOT NULL,
    generated_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    technician_id uuid NOT NULL,
    checklist_template_id uuid NOT NULL,
    checklist_version character varying NOT NULL,
    inspection_type public.inspection_type DEFAULT 'walkthrough'::public.inspection_type NOT NULL,
    performed_at timestamp(6) without time zone NOT NULL,
    completed_at timestamp(6) without time zone,
    synced_at timestamp(6) without time zone,
    hour_meter_reading integer NOT NULL,
    status public.inspection_status DEFAULT 'in_progress'::public.inspection_status NOT NULL,
    locked_at timestamp(6) without time zone,
    device_id character varying,
    client_generated_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    serial_number character varying NOT NULL,
    nfc_tag_id character varying,
    make character varying,
    model character varying,
    year integer,
    machine_class public.machine_class NOT NULL,
    drive_type public.drive_type NOT NULL,
    has_def boolean DEFAULT false NOT NULL,
    emissions_tier public.emissions_tier NOT NULL,
    checklist_template_id uuid NOT NULL,
    current_hour_meter integer,
    estimated_hours_per_week integer,
    next_100hr_due_at_hours integer,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: nfc_tag_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nfc_tag_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_id uuid NOT NULL,
    nfc_tag_id character varying NOT NULL,
    assigned_at timestamp(6) without time zone NOT NULL,
    removed_at timestamp(6) without time zone,
    assigned_by_user_id uuid,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_item_id uuid NOT NULL,
    s3_key character varying NOT NULL,
    s3_url character varying,
    sha256 character varying(64) NOT NULL,
    byte_size bigint,
    captured_at timestamp(6) without time zone NOT NULL,
    uploaded_at timestamp(6) without time zone,
    width integer,
    height integer,
    thumbnail_s3_key character varying,
    retention_state public.retention_state DEFAULT 'full'::public.retention_state NOT NULL,
    client_generated_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT photos_sha256_hex CHECK (((sha256)::text ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: signatures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signatures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid NOT NULL,
    signature_type public.signature_type NOT NULL,
    signer_name character varying NOT NULL,
    signer_role character varying,
    signer_statement text,
    image_s3_key character varying,
    sha256 character varying(64),
    signed_at timestamp(6) without time zone NOT NULL,
    device_id character varying,
    client_generated_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    email character varying NOT NULL,
    phone character varying,
    password_digest character varying NOT NULL,
    role public.user_role DEFAULT 'technician'::public.user_role NOT NULL,
    customer_id uuid,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: api_tokens api_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT api_tokens_pkey PRIMARY KEY (id);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: checklist_templates checklist_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_templates
    ADD CONSTRAINT checklist_templates_pkey PRIMARY KEY (id);


--
-- Name: consumable_records consumable_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_records
    ADD CONSTRAINT consumable_records_pkey PRIMARY KEY (id);


--
-- Name: customer_assignments customer_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_assignments
    ADD CONSTRAINT customer_assignments_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: discrepancy_alerts discrepancy_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_alerts
    ADD CONSTRAINT discrepancy_alerts_pkey PRIMARY KEY (id);


--
-- Name: high_severity_events high_severity_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.high_severity_events
    ADD CONSTRAINT high_severity_events_pkey PRIMARY KEY (id);


--
-- Name: inspection_items inspection_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_items
    ADD CONSTRAINT inspection_items_pkey PRIMARY KEY (id);


--
-- Name: inspection_notes inspection_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_notes
    ADD CONSTRAINT inspection_notes_pkey PRIMARY KEY (id);


--
-- Name: inspection_reports inspection_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_reports
    ADD CONSTRAINT inspection_reports_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: machines machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_pkey PRIMARY KEY (id);


--
-- Name: nfc_tag_history nfc_tag_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nfc_tag_history
    ADD CONSTRAINT nfc_tag_history_pkey PRIMARY KEY (id);


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT photos_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: signatures signatures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT signatures_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_on_inspection_a_id_inspection_b_id_5fe64cfe45; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_on_inspection_a_id_inspection_b_id_5fe64cfe45 ON public.discrepancy_alerts USING btree (inspection_a_id, inspection_b_id);


--
-- Name: index_api_tokens_on_token_digest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_api_tokens_on_token_digest ON public.api_tokens USING btree (token_digest);


--
-- Name: index_api_tokens_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_api_tokens_on_user_id ON public.api_tokens USING btree (user_id);


--
-- Name: index_checklist_templates_on_published_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_checklist_templates_on_published_at ON public.checklist_templates USING btree (published_at);


--
-- Name: index_checklist_templates_on_variant_and_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_checklist_templates_on_variant_and_version ON public.checklist_templates USING btree (machine_class, drive_type, has_def, version);


--
-- Name: index_consumable_records_on_inspection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_consumable_records_on_inspection_id ON public.consumable_records USING btree (inspection_id);


--
-- Name: index_consumable_records_on_machine_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_consumable_records_on_machine_id ON public.consumable_records USING btree (machine_id);


--
-- Name: index_customer_assignments_on_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_customer_assignments_on_customer_id ON public.customer_assignments USING btree (customer_id);


--
-- Name: index_customer_assignments_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_customer_assignments_on_user_id ON public.customer_assignments USING btree (user_id);


--
-- Name: index_customer_assignments_on_user_id_and_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_customer_assignments_on_user_id_and_customer_id ON public.customer_assignments USING btree (user_id, customer_id);


--
-- Name: index_customers_on_lower_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_customers_on_lower_name ON public.customers USING btree (lower((name)::text));


--
-- Name: index_discrepancy_alerts_on_inspection_a_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_discrepancy_alerts_on_inspection_a_id ON public.discrepancy_alerts USING btree (inspection_a_id);


--
-- Name: index_discrepancy_alerts_on_inspection_b_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_discrepancy_alerts_on_inspection_b_id ON public.discrepancy_alerts USING btree (inspection_b_id);


--
-- Name: index_discrepancy_alerts_on_machine_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_discrepancy_alerts_on_machine_id ON public.discrepancy_alerts USING btree (machine_id);


--
-- Name: index_discrepancy_alerts_on_reviewed_by_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_discrepancy_alerts_on_reviewed_by_user_id ON public.discrepancy_alerts USING btree (reviewed_by_user_id);


--
-- Name: index_high_severity_events_on_client_generated_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_high_severity_events_on_client_generated_id ON public.high_severity_events USING btree (client_generated_id);


--
-- Name: index_high_severity_events_on_inspection_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_high_severity_events_on_inspection_item_id ON public.high_severity_events USING btree (inspection_item_id);


--
-- Name: index_high_severity_events_on_owner_signature_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_high_severity_events_on_owner_signature_id ON public.high_severity_events USING btree (owner_signature_id);


--
-- Name: index_high_severity_events_on_resolved_by_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_high_severity_events_on_resolved_by_user_id ON public.high_severity_events USING btree (resolved_by_user_id);


--
-- Name: index_high_severity_events_on_resolved_in_inspection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_high_severity_events_on_resolved_in_inspection_id ON public.high_severity_events USING btree (resolved_in_inspection_id);


--
-- Name: index_inspection_items_on_carried_forward_from_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspection_items_on_carried_forward_from_item_id ON public.inspection_items USING btree (carried_forward_from_item_id);


--
-- Name: index_inspection_items_on_client_generated_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_inspection_items_on_client_generated_id ON public.inspection_items USING btree (client_generated_id);


--
-- Name: index_inspection_items_on_inspection_id_and_position; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_inspection_items_on_inspection_id_and_position ON public.inspection_items USING btree (inspection_id, "position");


--
-- Name: index_inspection_notes_on_author_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspection_notes_on_author_user_id ON public.inspection_notes USING btree (author_user_id);


--
-- Name: index_inspection_notes_on_client_generated_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_inspection_notes_on_client_generated_id ON public.inspection_notes USING btree (client_generated_id);


--
-- Name: index_inspection_notes_on_inspection_id_and_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspection_notes_on_inspection_id_and_created_at ON public.inspection_notes USING btree (inspection_id, created_at);


--
-- Name: index_inspection_notes_on_inspection_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspection_notes_on_inspection_item_id ON public.inspection_notes USING btree (inspection_item_id);


--
-- Name: index_inspection_reports_on_inspection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_inspection_reports_on_inspection_id ON public.inspection_reports USING btree (inspection_id);


--
-- Name: index_inspections_on_checklist_template_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspections_on_checklist_template_id ON public.inspections USING btree (checklist_template_id);


--
-- Name: index_inspections_on_client_generated_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_inspections_on_client_generated_id ON public.inspections USING btree (client_generated_id);


--
-- Name: index_inspections_on_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspections_on_customer_id ON public.inspections USING btree (customer_id);


--
-- Name: index_inspections_on_machine_id_and_performed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspections_on_machine_id_and_performed_at ON public.inspections USING btree (machine_id, performed_at DESC);


--
-- Name: index_inspections_on_technician_id_and_performed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_inspections_on_technician_id_and_performed_at ON public.inspections USING btree (technician_id, performed_at);


--
-- Name: index_machines_on_checklist_template_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_machines_on_checklist_template_id ON public.machines USING btree (checklist_template_id);


--
-- Name: index_machines_on_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_machines_on_customer_id ON public.machines USING btree (customer_id);


--
-- Name: index_machines_on_nfc_tag_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_machines_on_nfc_tag_id ON public.machines USING btree (nfc_tag_id);


--
-- Name: index_machines_on_serial_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_machines_on_serial_number ON public.machines USING btree (serial_number);


--
-- Name: index_nfc_tag_history_on_assigned_by_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_nfc_tag_history_on_assigned_by_user_id ON public.nfc_tag_history USING btree (assigned_by_user_id);


--
-- Name: index_nfc_tag_history_on_machine_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_nfc_tag_history_on_machine_id ON public.nfc_tag_history USING btree (machine_id);


--
-- Name: index_open_high_severity_events_on_machine_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_open_high_severity_events_on_machine_id ON public.high_severity_events USING btree (machine_id) WHERE (resolved_at IS NULL);


--
-- Name: index_photos_on_client_generated_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_photos_on_client_generated_id ON public.photos USING btree (client_generated_id);


--
-- Name: index_photos_on_inspection_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_photos_on_inspection_item_id ON public.photos USING btree (inspection_item_id);


--
-- Name: index_photos_on_s3_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_photos_on_s3_key ON public.photos USING btree (s3_key);


--
-- Name: index_photos_on_sha256; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_photos_on_sha256 ON public.photos USING btree (sha256);


--
-- Name: index_signatures_on_client_generated_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_signatures_on_client_generated_id ON public.signatures USING btree (client_generated_id);


--
-- Name: index_signatures_on_inspection_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signatures_on_inspection_id ON public.signatures USING btree (inspection_id);


--
-- Name: index_users_on_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_customer_id ON public.users USING btree (customer_id);


--
-- Name: index_users_on_lower_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_lower_email ON public.users USING btree (lower((email)::text));


--
-- Name: inspection_items inspection_items_immutable_when_locked; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inspection_items_immutable_when_locked BEFORE INSERT OR DELETE OR UPDATE ON public.inspection_items FOR EACH ROW EXECUTE FUNCTION public.uptime_guard_inspection_item();


--
-- Name: inspection_notes inspection_notes_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inspection_notes_append_only BEFORE DELETE OR UPDATE ON public.inspection_notes FOR EACH ROW EXECUTE FUNCTION public.uptime_reject_change();


--
-- Name: inspections inspections_immutable_when_locked; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER inspections_immutable_when_locked BEFORE DELETE OR UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.uptime_guard_inspection();


--
-- Name: photos photos_immutable_when_locked; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER photos_immutable_when_locked BEFORE INSERT OR DELETE OR UPDATE ON public.photos FOR EACH ROW EXECUTE FUNCTION public.uptime_guard_photo();


--
-- Name: signatures signatures_immutable_when_locked; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER signatures_immutable_when_locked BEFORE INSERT OR DELETE OR UPDATE ON public.signatures FOR EACH ROW EXECUTE FUNCTION public.uptime_guard_signature();


--
-- Name: inspections fk_rails_019f5d6344; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT fk_rails_019f5d6344 FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: inspection_items fk_rails_0967cd71f3; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_items
    ADD CONSTRAINT fk_rails_0967cd71f3 FOREIGN KEY (carried_forward_from_item_id) REFERENCES public.inspection_items(id);


--
-- Name: inspections fk_rails_104d413903; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT fk_rails_104d413903 FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: machines fk_rails_24e008550c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT fk_rails_24e008550c FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: customer_assignments fk_rails_2586817eea; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_assignments
    ADD CONSTRAINT fk_rails_2586817eea FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: machines fk_rails_2629db802d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT fk_rails_2629db802d FOREIGN KEY (checklist_template_id) REFERENCES public.checklist_templates(id);


--
-- Name: discrepancy_alerts fk_rails_2bce8e073d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_alerts
    ADD CONSTRAINT fk_rails_2bce8e073d FOREIGN KEY (inspection_b_id) REFERENCES public.inspections(id);


--
-- Name: inspection_notes fk_rails_462d6d8b16; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_notes
    ADD CONSTRAINT fk_rails_462d6d8b16 FOREIGN KEY (inspection_id) REFERENCES public.inspections(id);


--
-- Name: nfc_tag_history fk_rails_46341c3f4a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nfc_tag_history
    ADD CONSTRAINT fk_rails_46341c3f4a FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: discrepancy_alerts fk_rails_4b381fdf84; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_alerts
    ADD CONSTRAINT fk_rails_4b381fdf84 FOREIGN KEY (inspection_a_id) REFERENCES public.inspections(id);


--
-- Name: signatures fk_rails_5a0e2699ae; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signatures
    ADD CONSTRAINT fk_rails_5a0e2699ae FOREIGN KEY (inspection_id) REFERENCES public.inspections(id);


--
-- Name: customer_assignments fk_rails_5fabcc8a3c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_assignments
    ADD CONSTRAINT fk_rails_5fabcc8a3c FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: discrepancy_alerts fk_rails_63e55bd0a9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_alerts
    ADD CONSTRAINT fk_rails_63e55bd0a9 FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: high_severity_events fk_rails_6d38fdc335; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.high_severity_events
    ADD CONSTRAINT fk_rails_6d38fdc335 FOREIGN KEY (resolved_in_inspection_id) REFERENCES public.inspections(id);


--
-- Name: inspection_notes fk_rails_72899e049e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_notes
    ADD CONSTRAINT fk_rails_72899e049e FOREIGN KEY (author_user_id) REFERENCES public.users(id);


--
-- Name: consumable_records fk_rails_7f2f4e3a5a; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_records
    ADD CONSTRAINT fk_rails_7f2f4e3a5a FOREIGN KEY (inspection_id) REFERENCES public.inspections(id);


--
-- Name: high_severity_events fk_rails_8154e824d9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.high_severity_events
    ADD CONSTRAINT fk_rails_8154e824d9 FOREIGN KEY (inspection_item_id) REFERENCES public.inspection_items(id);


--
-- Name: high_severity_events fk_rails_81f50f6c93; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.high_severity_events
    ADD CONSTRAINT fk_rails_81f50f6c93 FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: inspections fk_rails_8344d598e5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT fk_rails_8344d598e5 FOREIGN KEY (checklist_template_id) REFERENCES public.checklist_templates(id);


--
-- Name: photos fk_rails_879015da82; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.photos
    ADD CONSTRAINT fk_rails_879015da82 FOREIGN KEY (inspection_item_id) REFERENCES public.inspection_items(id);


--
-- Name: users fk_rails_880e646010; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_880e646010 FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: inspection_reports fk_rails_8a749959bb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_reports
    ADD CONSTRAINT fk_rails_8a749959bb FOREIGN KEY (inspection_id) REFERENCES public.inspections(id);


--
-- Name: high_severity_events fk_rails_8b0465771f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.high_severity_events
    ADD CONSTRAINT fk_rails_8b0465771f FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id);


--
-- Name: inspection_items fk_rails_8b5a48fbcf; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_items
    ADD CONSTRAINT fk_rails_8b5a48fbcf FOREIGN KEY (inspection_id) REFERENCES public.inspections(id);


--
-- Name: high_severity_events fk_rails_8d976be506; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.high_severity_events
    ADD CONSTRAINT fk_rails_8d976be506 FOREIGN KEY (owner_signature_id) REFERENCES public.signatures(id);


--
-- Name: nfc_tag_history fk_rails_9c80960023; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nfc_tag_history
    ADD CONSTRAINT fk_rails_9c80960023 FOREIGN KEY (assigned_by_user_id) REFERENCES public.users(id);


--
-- Name: inspections fk_rails_b4972728cb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT fk_rails_b4972728cb FOREIGN KEY (technician_id) REFERENCES public.users(id);


--
-- Name: discrepancy_alerts fk_rails_bc772694d2; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discrepancy_alerts
    ADD CONSTRAINT fk_rails_bc772694d2 FOREIGN KEY (reviewed_by_user_id) REFERENCES public.users(id);


--
-- Name: inspection_notes fk_rails_ef43cbbbc7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inspection_notes
    ADD CONSTRAINT fk_rails_ef43cbbbc7 FOREIGN KEY (inspection_item_id) REFERENCES public.inspection_items(id);


--
-- Name: api_tokens fk_rails_f16b5e0447; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_tokens
    ADD CONSTRAINT fk_rails_f16b5e0447 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: consumable_records fk_rails_fa208ec6d4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumable_records
    ADD CONSTRAINT fk_rails_fa208ec6d4 FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('20260916000002'),
('20260916000001');

