# Field Dictionary Source Note

The runtime field dictionary source for `sales-opportunity-advisor` is no longer maintained in this markdown file.

Use the local TSV file instead:

`project://metadata/sales_opportunity_dictionary.tsv`

The main skill is responsible for:

- reading the TSV file
- interpreting `field_name`
- interpreting `field_description`
- filtering ignored fields
- mapping enum values
- formatting money / percent / date values
- building `profile` and `facts` in skill reasoning

This markdown file is kept only as a pointer so the source of truth is not split across code and reference docs.
