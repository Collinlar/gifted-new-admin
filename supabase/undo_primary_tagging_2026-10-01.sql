-- Undo the primary tagging pass of 1 October 2026.
-- Removes only the 11 rows it added; every pre-existing tag is untouched.
DELETE FROM track_items WHERE id IN (
  '5f7165d5-5a63-4f45-ba96-2b77b06a8bb3',  -- mathematics / Kangaroo Math Africa Summer Camp (3-4)
  'c0a714fc-714b-4513-9327-5b3abe1e325f',  -- mathematics / Maths Diagnostics Grade 1 - 3
  '78cab7b8-ad3d-483d-9923-a8939c412d87',  -- ict / GH STEM Olympiad Trial [Grade 2 & 3]
  'c3bd16d0-a1a7-4ea7-bb31-d20aeed9c5de',  -- science / GH STEM Olympiad Trial [Grade 2 & 3]
  '529ae17a-93e7-43eb-af09-44af53980692',  -- mathematics / Kangaroo Math Competition [ 1 & 2 ]
  '1934194b-6c95-491e-b786-6db3b9c51d18',  -- mathematics / Maths Diagnostics Grade 4 - 6 
  '8cee6468-0274-4e90-b225-fc5216f1148a',  -- ict / GH STEM Olympiad Trial [Grade 4 & 5]
  'fbd8c969-3e5d-4c8b-8889-a25140197a2b',  -- science / GH STEM Olympiad Trial [Grade 4 & 5]
  '243444ee-0a8a-42eb-acc8-8e64b97e21b1',  -- mathematics / Kangaroo Math Competition [ 3 & 4 ]
  '6e2b5348-4c73-4791-aa36-60889153e2e3',  -- mathematics / Kangaroo Math Africa Summer Camp (5-6)
  'c34cc052-24d9-488f-bd45-1824556f8c0a'   -- mathematics / Kangaroo Math Competition [ 5 & 6 ]
);
