-- Restore "Math Olympiads (Grade 3, 4, 5, 6)", merged away on 1 October 2026.
--
-- It and "Math Olympiads" were created four minutes apart with an identical
-- description, grade range, program, duration, level and instructor, and
-- neither carried progress, reviews, enrolments, modules or steps. Collins
-- chose to keep "Math Olympiads".
--
-- The only thing not carried over is this row's thumbnail, the CSAR-Math
-- reference book cover. The surviving course keeps the workbook cover, and
-- the description covers both books. The URL is preserved below.

INSERT INTO courses (id, mongo_id, title, description, grade, category, thumbnail, program, duration, publish, cost, tags, features, level, instructor, featured, rating, created_at, updated_at, steps)
VALUES ('8f7bdd0e-25d3-4181-b231-5c54019466c3', '68d67e210dd4abc4da71df12', 'Math Olympiads (Grade 3, 4, 5, 6)', 'A trial module for CSAR-Math. Includes: reference book and workbook', ARRAY['3','4','5','6']::text[], ARRAY['Mathematics']::text[], 'https://res.cloudinary.com/dcr9kvnd4/image/upload/v1758887456/course_thumbnail/CSAR-Math-Reference-Book-for%20All-1758887456359.png', ARRAY['International Science Olympiad']::text[], '10', false, NULL, '{}'::text[], '{}'::text[], 'Beginner', 'ISO', false, 0, '2025-09-26T11:50:57.065+00:00', '2026-10-01T01:22:17.531+00:00', '[]'::jsonb);

INSERT INTO track_items (id, track_id, item_type, item_id)
VALUES ('b0ccef82-323c-4a64-9831-888fbd2e18c7', '2884b4a9-4441-4498-9fb2-e042533f9ab7', 'course', '8f7bdd0e-25d3-4181-b231-5c54019466c3');
