-- Undo the primary tagging pass of 1 October 2026.
-- Removes only the 13 rows it added; every pre-existing tag is untouched.
DELETE FROM track_items WHERE id IN (
  '478a466c-41c8-4489-8f56-27578245df97',  -- mathematics / exam / Kangaroo Math Africa Summer Camp (3-4)
  '4022015c-6317-4cc7-b066-5aafb31ce302',  -- mathematics / exam / Maths Diagnostics Grade 1 - 3
  'e9698763-c5e0-4ed8-9c13-224143727b44',  -- ict / exam / GH STEM Olympiad Trial [Grade 2 & 3]
  '727d32a7-9609-442f-87dd-03db0f778097',  -- science / exam / GH STEM Olympiad Trial [Grade 2 & 3]
  '7207eb74-a702-4410-8540-c3b1162a0374',  -- mathematics / exam / Kangaroo Math Competition [ 1 & 2 ]
  'd7c440ec-5fa1-426f-982c-04af5b1f0654',  -- mathematics / exam / Maths Diagnostics Grade 4 - 6 
  '4b94f449-a0df-4823-8009-b375441c1b41',  -- mathematics / course / ea79a146-f89b-4a14-8bab-fa7ba2ec0db2
  '6b614694-6329-4d80-9cb5-d0234b18fef0',  -- ict / exam / GH STEM Olympiad Trial [Grade 4 & 5]
  '63f881fb-edde-4edf-9f6f-e7b78e2a33c5',  -- science / exam / GH STEM Olympiad Trial [Grade 4 & 5]
  'cd0f05ac-a80f-42ce-bcfa-b85d76489ee4',  -- mathematics / exam / Kangaroo Math Competition [ 3 & 4 ]
  'b0ccef82-323c-4a64-9831-888fbd2e18c7',  -- mathematics / course / 8f7bdd0e-25d3-4181-b231-5c54019466c3
  '442bb719-09c8-4059-8da8-ad7748fe1695',  -- mathematics / exam / Kangaroo Math Africa Summer Camp (5-6)
  '8d2c3034-de09-419e-bbb3-fd577de62b86'   -- mathematics / exam / Kangaroo Math Competition [ 5 & 6 ]
);
