| cert_code | current | proposed | reason |
|---|---|---|---|
| <RUN>-A-PEND-RECENT | pending | no_change | (already in target state) |
| <RUN>-B-PEND-STALE | pending | purge | no_pi_on_file_and_ttl_exceeded |
| <RUN>-C-ACTIVE | active | no_change | (already in target state) |
| <RUN>-D-ACTIVE-PAST | active | transition→expired | expires_at_in_past_so_active_to_expired |
| <RUN>-E-EXPIRED | expired | no_change | (already in target state) |
| <RUN>-F-REVOKED | revoked | no_change | (already in target state) |
| <RUN>-G-DISPUTED | disputed | no_change | (already in target state) |
| <RUN>-H-ACTIVE-NO-PI | active | transition→pending | cert_has_no_pi_and_within_ttl_so_should_be_pending |