-- Hand-edited: the UPDATE comes first so the unique index below can always be built.
-- Where several active members of a group store the same look, the earliest joiner keeps it and the others go back
-- to no stored look (their default, which the API moves on to a free look when it clashes).
UPDATE `memberships` SET `avatar_animal` = NULL, `avatar_color` = NULL
WHERE `left_at` IS NULL AND `avatar_animal` IS NOT NULL AND `avatar_color` IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM `memberships` AS `earlier`
    WHERE `earlier`.`group_id` = `memberships`.`group_id`
      AND `earlier`.`left_at` IS NULL
      AND `earlier`.`avatar_animal` = `memberships`.`avatar_animal`
      AND `earlier`.`avatar_color` = `memberships`.`avatar_color`
      AND (`earlier`.`joined_at` < `memberships`.`joined_at`
        OR (`earlier`.`joined_at` = `memberships`.`joined_at` AND `earlier`.`user_id` < `memberships`.`user_id`))
  );--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_active_look_uq` ON `memberships` (`group_id`,`avatar_animal`,`avatar_color`) WHERE left_at IS NULL AND avatar_animal IS NOT NULL AND avatar_color IS NOT NULL;
