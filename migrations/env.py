from alembic import context

from forgeworks.database import engine, metadata

if context.is_offline_mode():
    configured = engine()
    context.configure(url=configured.url, target_metadata=metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with engine().connect() as connection:
        context.configure(connection=connection, target_metadata=metadata)
        with context.begin_transaction():
            context.run_migrations()
