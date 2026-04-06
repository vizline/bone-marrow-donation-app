USE bone_marrow_app;

ALTER TABLE study_sessions
  ADD COLUMN profile_overview LONGTEXT NULL AFTER dominant_trait,
  ADD COLUMN communication_guidance LONGTEXT NULL AFTER profile_overview;
