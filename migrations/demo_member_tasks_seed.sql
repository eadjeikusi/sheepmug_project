-- Demo seed: 10 tasks per distinct member_id below (~58 members × 10 = ~580 rows).
-- Run after member_tasks.sql and member_tasks_checklist_related_members.sql (checklist column).
--
-- IMPORTANT: assignee_profile_id and created_by_profile_id must be public.profiles.id
-- (staff/auth users). They are NOT members.id. If your UUIDs are wrong type, fix:
--   SELECT id, email FROM public.profiles WHERE organization_id = '...';
--
-- Assigned BY (creator):  b237c354-1547-40f5-b7f0-8d33006f8dca
-- Assigned TO (assignee): 1da4ce65-2af9-47b6-89da-a148bd617b3d

INSERT INTO public.member_tasks (
  organization_id,
  branch_id,
  member_id,
  title,
  description,
  status,
  assignee_profile_id,
  created_by_profile_id,
  due_at,
  completed_at,
  checklist,
  created_at,
  updated_at
)
SELECT
  m.organization_id,
  m.branch_id,
  m.member_id,
  CASE gs.n
    WHEN 1 THEN 'First-time guest follow-up'
    WHEN 2 THEN 'Prayer request follow-through'
    WHEN 3 THEN 'Small group placement'
    WHEN 4 THEN 'Serving team onboarding'
    WHEN 5 THEN 'First-time giver thank-you'
    WHEN 6 THEN 'Retreat invitation and RSVP'
    WHEN 7 THEN 'Household profile refresh'
    WHEN 8 THEN 'Pastoral visit (home or coffee)'
    WHEN 9 THEN 'Baptism / membership pathway'
    ELSE 'Seasonal care package delivery'
  END,
  CASE gs.n
    WHEN 1 THEN 'Demo: welcome a recent visitor — complete the guest desk workflow and first-touch sequence.'
    WHEN 2 THEN 'Demo: close the loop on a Sunday prayer request with care and clear consent.'
    WHEN 3 THEN 'Demo: help them try a group — intro leader, logistics, and a follow-up after week one.'
    WHEN 4 THEN 'Demo: move someone from interest to first shadow shift on a ministry team.'
    WHEN 5 THEN 'Demo: acknowledge a first gift warmly and answer common giving questions.'
    WHEN 6 THEN 'Demo: personally invite them to a big event and track RSVP and practical needs.'
    WHEN 7 THEN 'Demo: refresh directory and safety details (address, emergency contact, preferences).'
    WHEN 8 THEN 'Demo: prep and run a relational visit; capture notes and next steps.'
    WHEN 9 THEN 'Demo: walk them through class, baptism, and membership conversations.'
    ELSE 'Demo: coordinate a simple care package drop-off and light touch feedback.'
  END,
  CASE (gs.n + abs(hashtext(m.member_id::text)) % 5) % 4
    WHEN 0 THEN 'completed'
    WHEN 1 THEN 'pending'
    WHEN 2 THEN 'in_progress'
    ELSE 'pending'
  END,
  '1da4ce65-2af9-47b6-89da-a148bd617b3d'::uuid,
  'b237c354-1547-40f5-b7f0-8d33006f8dca'::uuid,
  (now() + (gs.n || ' days')::interval),
  CASE
    WHEN (gs.n + abs(hashtext(m.member_id::text)) % 5) % 4 = 0 THEN now()
    ELSE NULL
  END,
  cl.checklist_json,
  now(),
  now()
FROM (
  SELECT DISTINCT ON (v.member_id)
    v.member_id,
    v.organization_id,
    v.branch_id
  FROM (VALUES
    ('07823c33-a30e-41b7-989e-42fce0638f8f'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('0b277776-6a60-4f68-a433-a754358c186a'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('0da46616-5291-4148-ac3b-7db216f6e2d5'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('0f7d2263-d131-4329-a499-80ecebbc1434'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('10202692-4501-4715-8a57-4a6ef4618627'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('105722ab-f0af-42e8-b217-a0b873e4c6a3'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('1282e541-3718-49c1-96b1-e4be5eb46ddb'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('1609f533-5293-4681-bb09-f285c840c26f'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('18869bf5-9979-48f5-9fb0-e76a9af5703c'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('1b1f7d8d-33b2-4bf6-9af5-c030af0027b1'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('22669dba-eb6c-4d19-9e48-79fecede9728'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('259780fc-21bd-4dda-af64-c8daf772f95f'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('28fb8c69-124c-46fa-83c4-c6d4f662fa52'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('2b207c9b-88fa-4441-b512-78045aaacc0b'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('37c14331-cedf-4874-9dd1-f7bcf5b908dc'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('3d568cce-32c2-47d5-9def-2ef53bd9155e'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('44094228-13b1-48d7-b7a1-3148887125fd'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('44755b11-2998-4c78-92da-316fcd791f28'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('4570de92-1c6c-409d-be2f-2e5cd21099d4'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('48544f32-a343-4f8f-876b-f1321cabd9e4'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('4a1fdb74-ac0d-4a8d-97be-a7c65371f9ef'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('4d9038c6-5cf7-412c-8031-cc335ba33856'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('4fccb353-c0cb-44a2-9cdb-25203af816ea'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('50ca358b-f0fd-442d-a9b8-e8e60b681933'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('5100d4ee-b64a-4436-aca0-b6ba7c0f9732'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('51d8dd6a-a94a-42d4-8367-cec2e4065916'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('592d36d6-dadb-4495-8545-211b81d1d7d7'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('5fe7f024-3b91-4e3d-92b5-43bfa2903a75'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('60d584c8-1237-4cf4-96e1-6c8111f3054c'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('63a31076-5e21-4b7b-9f99-ce90725b0c63'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('669ac0bf-14ac-494c-b449-2fa06f4ad84e'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('682303be-f19e-42ba-a55d-5c711faa9e5b'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('6eb5c0fc-8949-4b5e-8977-8e0f6bb8bda3'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('771dda1c-9916-4891-98e8-2407cf801ee4'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('790c3c4f-c7ba-4fa1-b818-0b4ab3445bc7'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('7f38e542-5835-4502-aece-4b11a5324ca9'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('87bd9f74-7be5-48f8-a969-680ab42e4b91'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('8a4a6daa-2223-4d95-8972-a56e47da3a33'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('8c05932c-b53a-4b56-80af-5160f929fa5a'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('8ffefa0f-898c-4f64-8671-f174f3e8d78e'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('96067fc1-9ce6-46d9-ac11-e19c78827bef'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('9ff20e35-9c6d-4585-84ca-aca7386afc33'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('a2e892db-ed62-4a7d-a6a0-80b5235ad438'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('a6972bdd-be23-4e9c-a337-d42c572dd5fb'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('a75136b3-7b16-4042-993b-221a39319b4b'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('b28af32a-8d65-4713-bb70-19acd08e6733'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('b5e626a6-698b-4b31-aae7-8a4936ab5538'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('c11f80cb-b0ae-4708-8867-4c945874d619'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('c8e88fea-e1b4-4a83-8944-3b3612b36cc8'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('d989b446-ac83-496b-a861-b61ca6732b3c'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('db8c1486-e667-4402-9dbb-7c37a1af0f50'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('dd68b0f7-67f7-46fe-8e6a-b764630fec88'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('e41c0513-50f1-4888-8bcf-f4f8df24fa7f'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid),
    ('ec06edd8-128d-40e1-9be6-993a5b8b0fce'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('eecfee0c-6340-4a24-b81c-07f51a566980'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('f2f7dfcb-6c34-46dd-8aae-21727484d27d'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('f684425d-0116-48d8-9076-56b219c854e8'::uuid, '54a6133a-9da1-48d1-873e-48f2d10dcd57'::uuid, '327a8ca9-de63-465c-9e97-e56005e04f78'::uuid),
    ('f924d2f2-3399-4e7d-8a43-7b01d93540b2'::uuid, 'dc694772-7c43-4bda-bc32-0744129d908f'::uuid, '377fad4f-342c-481f-bea9-04c312506ae4'::uuid)
  ) AS v(member_id, organization_id, branch_id)
  ORDER BY v.member_id, v.organization_id
) AS m
CROSS JOIN generate_series(1, 10) AS gs(n)
CROSS JOIN LATERAL (
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',
      (
        substr(md5(concat_ws('|', m.member_id::text, gs.n::text, lab.task_n::text, lab.ord::text)), 1, 8) || '-' ||
        substr(md5(concat_ws('|', m.member_id::text, gs.n::text, lab.task_n::text, lab.ord::text)), 9, 4) || '-' ||
        substr(md5(concat_ws('|', m.member_id::text, gs.n::text, lab.task_n::text, lab.ord::text)), 13, 4) || '-' ||
        substr(md5(concat_ws('|', m.member_id::text, gs.n::text, lab.task_n::text, lab.ord::text)), 17, 4) || '-' ||
        substr(md5(concat_ws('|', m.member_id::text, gs.n::text, lab.task_n::text, lab.ord::text)), 21, 12)
      )::text,
      'label',
      lab.label,
      'done',
      ((gs.n + lab.ord + abs(hashtext(m.member_id::text))) % 5) < 2
    )
    ORDER BY lab.ord
  ) AS checklist_json
  FROM (VALUES
    (1, 0, 'Return welcome-desk missed call; leave a warm voicemail if no answer'),
    (1, 1, 'Text or email link to this Sunday''s sermon notes and the plan-a-visit page'),
    (1, 2, 'Ask if they want a quick connect-card callback from a host team'),
    (1, 3, 'Log preferred contact method and best times on their profile'),
    (1, 4, 'Set a two-week reminder to check in again if they were first-time only'),

    (2, 0, 'Record the prayer request exactly as shared; note prayer circle permission'),
    (2, 1, 'Send a short encouragement text with one verse you discussed'),
    (2, 2, 'Add request to leader-only prayer list with date received'),
    (2, 3, 'Confirm whether it can be shared anonymously in bulletin or small group'),
    (2, 4, 'Offer a 15-minute call with pastoral staff if they asked for more support'),

    (3, 0, 'Send list of open groups with meeting times, locations, and childcare'),
    (3, 1, 'Email introduction to the group leader and CC the member'),
    (3, 2, 'Confirm childcare needs or accessibility for their first night'),
    (3, 3, 'Tag roster: Trying Group B — first visit week of [date]'),
    (3, 4, 'Follow up after first attended night; ask how it felt and next step'),

    (4, 0, 'Send ministry fair PDF and highlight two teams that fit their gifts'),
    (4, 1, 'Introduce serving team lead and propose a guest shadow Sunday'),
    (4, 2, 'If kids ministry: confirm background check link sent and deadline'),
    (4, 3, 'Log availability (monthly vs weekly) and any training dates'),
    (4, 4, 'Thank them after first serve and note one win to celebrate'),

    (5, 0, 'Send a personal thank-you for their first recorded gift'),
    (5, 1, 'Briefly explain local vs global impact buckets they supported'),
    (5, 2, 'Invite questions on recurring giving, fees, or yearly statements'),
    (5, 3, 'Confirm email on file for annual giving statement'),
    (5, 4, 'Schedule a light story-plus-thanks touch next quarter'),

    (6, 0, 'Personal invite to retreat with registration link and deadline'),
    (6, 1, 'Ask about rides, roommate pairing, or scholarship needs'),
    (6, 2, 'Remind them of early-bird pricing cutoff three days before'),
    (6, 3, 'If cost is a barrier, share scholarship form and who approves'),
    (6, 4, 'Log RSVP status when paid or confirmed; add to event attendee list'),

    (7, 0, 'Verify mailing address, mobile number, and email on file'),
    (7, 1, 'Update emergency contact after recent life or household change'),
    (7, 2, 'Confirm spouse and children names for directory opt-in / opt-out'),
    (7, 3, 'Note food allergies for potlucks or hospitality events'),
    (7, 4, 'Record no-photography or stage visibility preferences if mentioned'),

    (8, 0, 'Propose two concrete dates for coffee or home visit'),
    (8, 1, 'Confirm address, parking, and any pet or access notes'),
    (8, 2, 'Prep visit notes: family, work, faith journey, current burdens'),
    (8, 3, 'Bring welcome bag or book you agreed on in prior message'),
    (8, 4, 'Log visit summary, prayer items, and dated next steps in notes'),

    (9, 0, 'Share class schedule for Explore / Foundations and how to sign up'),
    (9, 1, 'Answer baptism vs dedication questions in plain language'),
    (9, 2, 'Introduce an elder for membership conversation when they are ready'),
    (9, 3, 'Add them to class roster once registration is complete'),
    (9, 4, 'Send calendar hold for potential baptism Sunday and rehearsal'),

    (10, 0, 'Confirm best delivery address and safe drop-off instructions'),
    (10, 1, 'Add kids activity pack to order notes if household has children'),
    (10, 2, 'Schedule porch drop-off window and who is delivering'),
    (10, 3, 'Text on-the-way with ETA and photo of package at door'),
    (10, 4, 'Ask for quick feedback after delivery; log any prayer follow-ups')
  ) AS lab(task_n, ord, label)
  WHERE lab.task_n = gs.n
) AS cl;
