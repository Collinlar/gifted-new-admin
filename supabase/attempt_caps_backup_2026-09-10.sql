-- Attempt caps as they stood before they were all set to 0 on 10 Sep 2026.
-- Every assessment had a cap, but the caps had never been enforced: the
-- attempts lookup could not match a single row, so everyone read 0 attempts
-- made. Fixing that would have blocked 295 student and quiz pairs from
-- retaking overnight, so the caps were cleared instead.
--
-- To put one back, run its line. To restore everything, run the file.

UPDATE exams SET attempts_allowed = 3 WHERE id = 'f06c90a8-e012-40f6-91da-c5a5d47b66e4';  -- AMO PRIMARY 2 (GRADE 2) 2023 CONTEST PAPER
UPDATE exams SET attempts_allowed = 10 WHERE id = 'e0dce438-2fee-4dfd-8b31-c44fcc56cd05';  -- Geography Olympiad 2025
UPDATE exams SET attempts_allowed = 10 WHERE id = 'e23d5916-db20-427a-b64f-7e218e9f6f40';  -- Geography Olympiad 2026
UPDATE exams SET attempts_allowed = 5 WHERE id = '040641d9-de20-444c-89a8-0350e99183ad';  -- GH - STEM Olympiad 2025 (Junior STEMmers)
UPDATE exams SET attempts_allowed = 5 WHERE id = 'f4b6c372-cf56-46af-bcb0-4c11d2a67c98';  -- GH - STEM Olympiad 2025 (Little STEMmers)
UPDATE exams SET attempts_allowed = 10 WHERE id = 'a8bb02e9-80cc-454b-b815-29c24ae8d52e';  -- GH - STEM Olympiad 2025 (Senior STEMmers)
UPDATE exams SET attempts_allowed = 20 WHERE id = 'e50c5966-55af-461d-8ae9-b184b6828a98';  -- GH STEM Olympiad Trial [Grade 10, 11 & 12]
UPDATE exams SET attempts_allowed = 20 WHERE id = '278dcdec-b3d6-4f5c-895d-73e01477a621';  -- GH STEM Olympiad Trial [Grade 2 & 3]
UPDATE exams SET attempts_allowed = 20 WHERE id = '9321f89f-4858-45be-aee7-5824b4e5e910';  -- GH STEM Olympiad Trial [Grade 4 & 5]
UPDATE exams SET attempts_allowed = 20 WHERE id = '8809e379-1f3f-41af-84b7-def9d2a3a89c';  -- GH STEM Olympiad Trial [Grade 6 & 7]
UPDATE exams SET attempts_allowed = 20 WHERE id = '70344aca-a44a-4eed-88f6-929fd35f9b28';  -- GH STEM Olympiad Trial [Grade 8 & 9]
UPDATE exams SET attempts_allowed = 20 WHERE id = 'ae6848e8-5e54-45d2-9ca9-1c5529f8650c';  -- GH STEM Olympiad Trial 1 [ Grade 7, 8, 9 & 10]
UPDATE exams SET attempts_allowed = 20 WHERE id = '0c35e0d6-2f5b-41ee-b74f-7e8c70b5e81c';  -- GH STEM Olympiad Trial 2 [ Grade 7, 8, 9 & 10]
UPDATE exams SET attempts_allowed = 1 WHERE id = 'a8150cf8-81ea-4708-81b1-5dc38dfd632a';  -- GH STEM(SENIORS) - FINAL ROUND__CHEMISTRY 
UPDATE exams SET attempts_allowed = 1 WHERE id = '7ad50b8b-a5f7-4dc4-af46-4bb85577e471';  -- GH STEM(SENIORS) - FINAL ROUND_BIOLOGY
UPDATE exams SET attempts_allowed = 1 WHERE id = 'eaa26e90-14db-42d5-b7a2-fc47456b0891';  -- GH STEM(SENIORS) - FINAL ROUND_PHYSICS
UPDATE exams SET attempts_allowed = 10 WHERE id = '4d22768a-136d-4866-80e7-b160489d73c9';  -- HIPPO English [Grade 1&2] - Quiz 1
UPDATE exams SET attempts_allowed = 10 WHERE id = 'd57af0c1-9546-4da5-810e-aa5c2f5ce7b9';  -- HIPPO English [Grade 10&11] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '248c23f9-edc4-431e-893c-dfde802df12f';  -- HIPPO English [Grade 3&4] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = 'c5acff50-b8da-4d4e-8cce-34a5b8c144a7';  -- HIPPO English [Grade 5&6] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = 'e6ed0511-c2ca-462c-a599-b1d05a8bc808';  -- HIPPO English [Grade 7] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = 'd805e0aa-3c6d-4982-ab30-7d5857c67b1a';  -- HIPPO English [Grade 8&9] - Quiz 1
UPDATE exams SET attempts_allowed = 10 WHERE id = '95c3257c-5960-4a8c-959b-a68d66dfc583';  -- HIPPO English Olympiad [Grade 12] - Quiz 1
UPDATE exams SET attempts_allowed = 20 WHERE id = '1e224bd7-ed7e-4da2-907b-25c948224614';  -- International STEM Olympiad Grade 1
UPDATE exams SET attempts_allowed = 3 WHERE id = 'baf1d0a5-ea4b-4628-b259-0ef0774e0942';  -- Junior Sharks Preliminary Round 1 (Social Literacy)
UPDATE exams SET attempts_allowed = 3 WHERE id = '0debd087-a0b3-4c65-87bb-4b39c8eb22d4';  -- Junior Sharks Preliminary Round 2 (R cubed)
UPDATE exams SET attempts_allowed = 3 WHERE id = 'f43878f5-4706-4c35-824d-efccc11b5747';  -- Junior Sharks Preliminary Round 3 (STEM)
UPDATE exams SET attempts_allowed = 4 WHERE id = '3a8bee50-0be4-4da8-ba1e-4d44979f0352';  -- Junior Sharks Preliminary Round 4
UPDATE exams SET attempts_allowed = 1 WHERE id = 'b3616bc9-d805-45df-8fc4-9d550439ac24';  -- Kangaroo Math Africa Summer Camp (3-4)
UPDATE exams SET attempts_allowed = 1 WHERE id = '83b56bcc-6631-4b3a-8d32-ebcc4c4c09a2';  -- Kangaroo Math Africa Summer Camp (5-6)
UPDATE exams SET attempts_allowed = 1 WHERE id = 'bdef78e9-e382-4d68-858e-c4de734b6ee2';  -- Kangaroo Math Africa Summer Camp (7-8)
UPDATE exams SET attempts_allowed = 10 WHERE id = 'f9ff50de-74a4-4a02-9a68-12472d991c64';  -- Kangaroo Math Africa Summer Camp (9-10)
UPDATE exams SET attempts_allowed = 10 WHERE id = '004fcb2f-0ceb-4488-baef-0d4bf325dcd1';  -- Kangaroo Math Competition [ 1 & 2 ]
UPDATE exams SET attempts_allowed = 10 WHERE id = 'ca758e76-849c-45ff-bfc2-c304971800b8';  -- Kangaroo Math Competition [ 11 & 12 ]
UPDATE exams SET attempts_allowed = 10 WHERE id = '24f82bbd-c849-498b-ad88-8fcf277b5a64';  -- Kangaroo Math Competition [ 3 & 4 ]
UPDATE exams SET attempts_allowed = 10 WHERE id = 'c4f99fec-70a9-4573-bcec-ce1467ebdbfd';  -- Kangaroo Math Competition [ 5 & 6 ]
UPDATE exams SET attempts_allowed = 10 WHERE id = '133c97e3-f2b0-40bd-8cd7-32315ec1fd31';  -- Kangaroo Math Competition [ 7 & 8 ]
UPDATE exams SET attempts_allowed = 10 WHERE id = 'b452078d-38ee-463c-8c0a-bf5d3feaac22';  -- Kangaroo Math Competition [ 9 & 10 ]
UPDATE exams SET attempts_allowed = 1 WHERE id = 'dd686180-fc94-4e72-b026-da6a86a54dd3';  -- Maths Diagnostics Grade 1 - 3
UPDATE exams SET attempts_allowed = 1 WHERE id = '79ca69f9-4247-4862-9519-10bc751532f5';  -- Maths Diagnostics Grade 10 - 12
UPDATE exams SET attempts_allowed = 1 WHERE id = '588b2bf5-afec-4fa9-a9b8-6297be82cb28';  -- Maths Diagnostics Grade 4 - 6 
UPDATE exams SET attempts_allowed = 1 WHERE id = '04520a2b-df1b-464a-b958-4bbf54518b1a';  -- Maths Diagnostics Grade 7 - 9
UPDATE exams SET attempts_allowed = 10 WHERE id = 'b4be6658-daed-4004-937d-976e55277cdb';  -- Round 2 - Biology, Senior STEMmers (GH STEM Olympiad 2025)
UPDATE exams SET attempts_allowed = 10 WHERE id = 'a54e63c2-9738-47fa-b592-3f1c39dc5ebc';  -- Round 2 - Chemistry, Senior STEMmers (GH STEM Olympiad 2025)
UPDATE exams SET attempts_allowed = 10 WHERE id = '4ac1fba3-3b09-493b-8276-6096cfcbf3a1';  -- Round 2 - Physics, Senior STEMmers (GH STEM Olympiad 2025)
UPDATE exams SET attempts_allowed = 2 WHERE id = '9f827669-b5df-4b7e-9688-b1a1d9eb05f0';  -- Senior Sharks Preliminary Round 1 (Social Literacy)
UPDATE exams SET attempts_allowed = 2 WHERE id = 'a6ea01be-4cea-4017-a27b-2e9e0a0e040c';  -- Senior Sharks Preliminary Round 2 (R cubed)
UPDATE exams SET attempts_allowed = 2 WHERE id = '32ce9534-dfae-4844-ab9e-4a775bd6e223';  -- Senior Sharks Preliminary Round 3 (STEM)
UPDATE exams SET attempts_allowed = 10 WHERE id = '4d0d3cc3-79b7-436f-8c15-6a95b5032bd0';  -- Senior Sharks Preliminary Round 4
UPDATE exams SET attempts_allowed = 2 WHERE id = '01b704cf-d5fe-40da-9849-f29b43ccf8d9';  -- Senior Sharks Preliminary Round 4
UPDATE exams SET attempts_allowed = 10 WHERE id = '70f1ce21-9405-4379-87e4-3177ed3070b7';  -- Singapore and Asian Schools Math Olympiad [Grade 10] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '23785eb4-5439-4444-8ba7-86297a0dee9c';  -- Singapore and Asian Schools Math Olympiad [Grade 2] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '48cc528a-7e9b-43e6-99dc-420b70d5dc04';  -- Singapore and Asian Schools Math Olympiad [Grade 3] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '24dbe5a1-c6b2-4909-b601-536f9a9c809f';  -- Singapore and Asian Schools Math Olympiad [Grade 4] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '3f205e88-77ad-47ab-aae9-0c3089f8c574';  -- Singapore and Asian Schools Math Olympiad [Grade 5] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '43b41e31-9694-4685-882a-64f6080cd9b3';  -- Singapore and Asian Schools Math Olympiad [Grade 6] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '2e8f3225-44e9-49df-b04e-5232cc917957';  -- Singapore and Asian Schools Math Olympiad [Grade 7] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '70cf4838-93a5-4595-8818-71a98d4b7cd0';  -- Singapore and Asian Schools Math Olympiad [Grade 8] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = '3ff93556-9826-41df-ba1d-80280aa2fac5';  -- Singapore and Asian Schools Math Olympiad [Grade 9] - Quiz 1
UPDATE exams SET attempts_allowed = 5 WHERE id = '782373c9-d958-47d7-a3e6-382d1eff8e86';  -- STEM and Geography for all Grades
UPDATE exams SET attempts_allowed = 10 WHERE id = 'b26f04ab-5c0b-438f-b3b0-30c81c5e27a4';  -- test_import_Gfted
UPDATE exams SET attempts_allowed = 3 WHERE id = '4821251a-d0e6-42dc-9553-093696f62ba5';  -- Vanda International Science Competition [Grade 3] - Quiz 1
UPDATE exams SET attempts_allowed = 10 WHERE id = '19a800d7-43dc-4041-bc6a-e385db14dfad';  -- Vanda International Science Competition [Grade 3] - Quiz 2
UPDATE exams SET attempts_allowed = 1 WHERE id = '55d7f3f5-a117-4d89-bbf8-294f4aa330be';  -- Vanda Science Olympiad [Grade 10] - Quiz 1
UPDATE exams SET attempts_allowed = 10 WHERE id = '7e87a0ba-64ab-47a7-8863-2e98506ca5fe';  -- Vanda Science Olympiad [Grade 4] - Quiz 1
UPDATE exams SET attempts_allowed = 10 WHERE id = 'f92dbaec-777e-4ee4-9ab6-dc81ddc68024';  -- Vanda Science Olympiad [Grade 5] - Quiz 1
UPDATE exams SET attempts_allowed = 10 WHERE id = 'e7d27ec1-7fa5-4c16-9183-e6a19c5347b6';  -- Vanda Science Olympiad [Grade 6] - Quiz 1
UPDATE exams SET attempts_allowed = 10 WHERE id = 'd61cdd00-dae8-400c-92a5-b9d4bdb6889a';  -- Vanda Science Olympiad [Grade 7] - Quiz 1
UPDATE exams SET attempts_allowed = 10 WHERE id = '28e51fe2-4044-43b5-a007-bd76f1d70dd0';  -- Vanda Science Olympiad [Grade 8] - Quiz 1
UPDATE exams SET attempts_allowed = 1 WHERE id = 'ca0f8a02-1d59-4901-8546-5e307a65407b';  -- Vanda Science Olympiad [Grade 9] - Quiz 1
