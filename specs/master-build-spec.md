# DevUps Growth OS — Master Build Spec (para Claude Code)

> Prompt maestro autocontenido. Construí este sistema respetando SIEMPRE la sección **Guardrails** por encima de cualquier feature. Construí en el **orden del Roadmap** (núcleo validado primero). Los agentes corren en **modo sugerencia** hasta pasar la **Puerta de autonomía**.

---

## 0 · Cómo trabajar
- Stack fijo (§2). Código TypeScript estricto, tests con cada feature, migraciones versionadas.
- No mergees sin revisar; corré `/security-review` en lo sensible. Nada de secretos en git.
- Empezá por el **núcleo** (§8 Roadmap, Fase 1) y validá economía antes de sumar capas.

## 1 · Qué es
Plataforma de growth para **DevUps** (staff-augmentation nearshore). Consigue leads → verifica emails → outreach personalizado y con warmup → clasifica respuestas con IA → agenda reuniones → entrega **shortlists de devs** (matching contra el sistema de talento externo, vía MCP). Todo operado por un enjambre de agentes con **Jarvis** (voz) al frente, medido y gobernado, multi-usuario con permisos.

## 2 · Stack
TypeScript (Node 20). API/workers: Fastify o NestJS. **Postgres con RLS** (Drizzle/Prisma, migraciones versionadas) + `pgvector`. Colas: BullMQ + Redis. **Scheduler de infraestructura** (no in-app). Secrets: Doppler/AWS SM + KMS. Observabilidad: OpenTelemetry + Sentry. LLM detrás de un wrapper propio con **function-calling estricto**. STT: Deepgram/Whisper; TTS: ElevenLabs/OpenAI; wake word: Picovoice.

## 3 · GUARDRAILS (no-negociables, aplican a todo)
1. **Secretos:** cero en git; solo secrets manager; tokens OAuth cifrados con KMS, scopes mínimos, rotación; `gitleaks` en CI.
2. **Prompt injection:** todo input externo (emails/replies/WhatsApp/adjuntos) es **dato no confiable, nunca instrucción**. Separar SYSTEM vs CONTENIDO. **Ninguna acción irreversible se dispara desde contenido externo.** LLM solo vía function-calling con esquemas estrictos + allow-list de tools por agente.
3. **Auth & aislamiento:** MCP/APIs con auth real (no `?token=`), TLS, rate limit, validación. **RLS en Postgres** como fuente de aislamiento.
4. **Datos:** cifrado en tránsito/reposo, audit log, minimización, retención/purga, **DSR** (export/delete), backups con restore probado.
5. **Agentes:** human-in-the-loop para lo irreversible; kill switch global + por agente; dry-run; umbrales de confianza; presupuestos/rate caps por agente; trazas auditables.
6. **Ops:** scheduler real; **idempotencia** en envíos (dedupe key lead+campaña); colas + reintentos + dead-letter; circuit breakers; degradación elegante; transacciones.
7. **Compliance:** **supresión pre-envío bloqueante** (clientes/deals/bajas) + anti-reenvío; unsubscribe + dirección física; opt-out cross-canal; revisión legal por región.

## 4 · Modelo de datos (núcleo)
- **orgs, users** (role owner/admin/member), **mailboxes** (user_id, domain_id, oauth token ref, warmup_stage, daily_cap, health, status).
- **accounts** (empresa, relationship prospect/customer/partner), **contacts** (+contact_identities por canal), **leads** (contact_id, account_id, funnel_id, stage, close_probability, intent, score, language, phone, opt_in).
- **funnels** (stages jsonb, rules, active), **lead_tags**, **topics** + **message_topics**.
- **email_log / messages** (channel, mailbox_id, assigned_user_id, thread_id, status), **replies** (category, sentiment, close_probability, draft), **follow_ups**.
- **suppression**, **contacted_registry** (email único/org, first/last, by_mailbox, source), **consent_log**.
- **needs, matches, shortlists, talent_cache** (entrega). **documents** (+versions, smart_views, templates).
- **voice_profiles, memory documents/chunks (vector), briefings, meetings, availability_rules**.
- **skills** (+invocations), **agent_traces, budgets, outcomes, icp_weights, experiments/variants/assignments/events, domains, dsr_requests, retention_policies, audit_log**.
- Toda tabla con `org_id`; **RLS**: fila visible si es owner/admin, o `assigned_user_id = auth.uid()`, o hay `visibility_grant`.

## 5 · Módulos (qué hace cada uno)

**Núcleo (Fase 1)**
- **Motor & Envío:** dedup + **anti-reenvío** (escaneo continuo de todos los buzones → `contacted_registry`) + supresión bloqueante; prioriza por score/intención; envía por Gmail API multi-buzón con **warmup, rotación, límites y salud**; idempotente; scheduler real. Idioma EN/PT/ES.
- **Sourcing:** Gojiberry + Apollo (+ TheirStack) → dedup → **Anymail Finder** (verifica email, solo válidos) → import a `leads` con reglas de idioma/prioridad.
- **Personalización con señal:** primer toque cita el disparador real del lead (vacante/tech stack/ronda), generado por el redactor; fallback genérico; listo para A/B.
- **Deliverability a escala:** dominios/buzones secundarios, warmup automático, rotación, seed/placement tests, monitoreo DMARC; aísla el dominio principal.

**Conversión (Fase 2)**
- **Respuestas/Triage:** detecta replies (Gmail), clasifica (categoría, sentimiento, **prob. de cierre**), rutea; corta cadencia.
- **Redactor IA (voz + contexto):** borradores en la voz de cada miembro, con contexto (hilo + CRM + memoria) y assets proactivos; aprende de las ediciones. Human-in-the-loop en lo caliente.
- **Cadencia de follow-up:** +3d/+7d/+14d; se corta ante respuesta/baja.
- **Pipeline & Funnels:** kanban configurable, múltiples funnels, drag&drop, tags por tema, filtros.
- **Calendario & agendamiento:** Google/Outlook free/busy → propone horarios → **auto-book** con Meet → recordatorios; round-robin; zona horaria.
- **Entrega/Talento (MCP):** el motor es **cliente MCP** del sistema de talento (`search_devs`, `get_dev`); captura la **necesidad**, hace **matching** (reglas+semántico), arma **shortlist** que el redactor incluye.

**Inteligencia (Fase 3)**
- **Memoria unificada + búsqueda:** indexa todo (pgvector), Q&A en lenguaje natural con fuentes, RLS.
- **Conexión de conversaciones:** entity resolution cross-canal + timeline único + **contexto proactivo** (surface del asset relacionado).
- **Auto-etiquetado por tema**, **Perfil 360 + prep de reunión**, **Briefing diario priorizado**, **Hub de Documentos** (auto-organiza propuestas/contratos/shortlists), **Jarvis** (voz + **registro de skills** extensible, front-end del orquestador).

**Equipo & Gobierno (transversal)**
- **Equipo/permisos:** roles, un buzón por miembro, visibilidad por RLS. **Agente WhatsApp** (número dedicado): avisa, comandos, log.
- **Analytics + A/B**, **Gobierno**: CRM = fuente de verdad (lee todos los mensajes), **loop resultados→ICP**, **agent-ops** (evals/costo/kill switch/trazas), **privacidad/DSR**.

## 6 · Agentes (orquestador + 12)
Orquestador (delega/escala) + Concierge (WhatsApp/voz) · Sourcing · Copywriter · Envío · Follow-up · Triage · Agendador · Research/360 · Memoria/Bibliotecario · Briefing · Guardianes: Entregabilidad & Salud, Compliance (con veto). Cada agente: allow-list de tools, disparadores, handoffs (ver `/specs/devups-mapa-de-agentes.md`). Corren en **modo sugerencia** hasta la Puerta de autonomía.

## 7 · MCP surface (tools del motor)
`get_stats, get_pipeline_stats, list_pending_leads, preview_email, create_todays_batch, send_batch, pause, resume, import_leads, add_suppression, check_contacted, run_sourcing, list_replies, classify_reply, set_stage, schedule_followup, propose_slots, book_meeting, search_conversations, summarize_contact, get_contact_timeline, find_related, suggest_context, get_briefing, list_funnels, get_board, move_lead, search_documents, generate_document, run_sourcing, list_skills` — todas con auth real + RLS + validación.

## 8 · Roadmap de construcción
- **Fase 0 — Fundamento:** repo + stack + CLAUDE.md + secrets + CI (tests/lint/typecheck/secret-scan) + Postgres/RLS + auth + scheduler + colas + observabilidad.
- **Fase 1 — Núcleo (validar economía):** leads + import + Sourcing/Anymail + dedup/anti-reenvío/supresión + Envío multi-buzón con warmup + Personalización con señal + Pipeline básico + Triage de respuestas + **borradores con aprobación humana**. → medir respuesta→reunión→deal y **costo por reunión**.
- **Fase 2 — Conversión:** redactor con voz, cadencias, calendario/agendamiento, entrega/talento (MCP), analytics + A/B.
- **Fase 3 — Inteligencia:** memoria/búsqueda, conexión/contexto, 360/prep, briefing, documentos, auto-etiquetado, Jarvis + skills.
- **Fase 4 — Autonomía:** solo tras pasar la **Puerta** (§10): activar agentes autónomos con guardrails.
- **Transversal:** equipo/permisos, WhatsApp ops, gobierno/DSR/agent-ops se van sumando desde Fase 1.

## 9 · Definition of Done (cada PR)
Tests + evals (si toca prompts) · lint/type-check/secret-scan en verde · sin secretos · sin acciones irreversibles disparables por input externo · auth+validación+RLS · idempotencia y retries en jobs · `/security-review` en lo sensible · specs/ADR actualizados.

## 10 · Puerta de autonomía (bloqueante)
Ningún agente envía/actúa solo hasta tener: secretos en manager + tokens cifrados · defensa de prompt injection · auth real + RLS · human-in-the-loop en lo irreversible · kill switch · scheduler real + idempotencia · supresión bloqueante. Hasta entonces: **modo sugerencia** (propone, humano confirma).

---
*Specs detallados por módulo en `/specs` (`devups-*-lovable-prompt.md` → renombrar a specs; el nombre "lovable" es histórico, el build va en Claude Code). Índice: `devups-indice-documentos.md`.*
