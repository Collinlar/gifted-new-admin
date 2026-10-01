-- Restore the duplicate course deleted on 1 October 2026.
--
-- "International Science Olympiad (Grade 3& 4)" existed twice. The copy kept
-- (533fb8e2-...) carries 3 course_progress rows and 2 course_details modules.
-- This one carried nothing: no progress, no reviews, no enrolments, no
-- modules, no steps, an empty description. Only its science track tag, which
-- is recreated below.

INSERT INTO courses (id, mongo_id, title, description, grade, category, thumbnail, program, duration, publish, cost, tags, features, level, instructor, featured, rating, created_at, updated_at, steps)
VALUES ('d015e320-902b-43a9-8023-cdd35444d137', '690b017e6dd6119ea3dd1058', 'International Science Olympiad (Grade 3& 4)', '', ARRAY['3','4']::text[], ARRAY['Science']::text[], 'https://res.cloudinary.com/dcr9kvnd4/image/upload/v1762328958/course_thumbnail/CSAR-ISO-Workbook%20for%20All-1762328957662.png', ARRAY['International Science Olympiad']::text[], '40', false, NULL, '{}'::text[], '{}'::text[], 'Beginner', 'ISO', false, 0, '2025-11-05T07:49:18.636+00:00', '2026-09-11T15:52:05.04+00:00', '[]'::jsonb);

INSERT INTO track_items (id, track_id, item_type, item_id)
VALUES ('44157bd5-b9c4-433c-ad92-e2f9a37a62d3', 'f11e3337-c3f1-44eb-963c-a06bd5452029', 'course', 'd015e320-902b-43a9-8023-cdd35444d137');
